import { createHash, randomUUID } from "node:crypto";
import type { Job } from "pg-boss";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db.js";
import { progressLeaseStalled } from "./execution-lease.js";
import { toPostgresJsonValue } from "../lib/postgres-json.js";

const CHECKPOINT_WRITE_INTERVAL_MS = 5_000;
export type JobExecutionContext = {
  businessKey: string;
  signal: AbortSignal;
  deadlineAt: Date;
  checkpoint(progress: Record<string, unknown>): Promise<void>;
  /** Refresh the in-process meaningful-progress watchdog without adding a database write. */
  touch(): void;
  complete(result: unknown, options?: { allowAborted?: boolean }): Promise<void>;
  fail(error: unknown): Promise<void>;
};
export type CreateJobExecutionContextInput<T> = {
  queueName: string;
  job: Job<T>;
  businessKey: string;
  payloadGeneration: number;
  sourceSnapshot?: unknown;
  decoderGeneration?: string;
  configurationGeneration?: string;
  timeoutMs: number;
  /**
   * Optional meaningful-progress watchdog. Enable this only for jobs whose operation reports
   * progress throughout every legitimate long wait. Distributed RPC capacity and rate budgets
   * can intentionally queue work for several minutes, so a generic watchdog would abort healthy
   * jobs while the hard deadline already provides the universal execution bound.
   */
  stallTimeoutMs?: number;
};
export type JobExecutionStart<R> =
  | { completed: true; result: R }
  | { completed: false; context: JobExecutionContext };
export class BusinessExecutionInProgressError extends Error {
  readonly retryAt: Date;
  constructor(businessKey: string, retryAt: Date) {
    super(`business execution is already active for ${businessKey} until ${retryAt.toISOString()}`);
    this.name = "BusinessExecutionInProgressError";
    this.retryAt = retryAt;
  }
}
export class BusinessExecutionLeaseLostError extends Error {
  constructor(businessKey: string) {
    super(`business execution lease was lost for ${businessKey}`);
    this.name = "BusinessExecutionLeaseLostError";
  }
}
function resultDigest(encodedValue: string): string {
  return createHash("sha256").update(encodedValue).digest("hex");
}
type ClaimOrReplayRow<R> = {
  disposition: "claimed" | "completed" | "busy";
  result: R | null;
  executionToken: string | null;
  retryAt: Date | null;
};
async function claimOrReadExecutionLease<T, R>(
  input: CreateJobExecutionContextInput<T>,
  deadlineAt: Date,
): Promise<ClaimOrReplayRow<R>> {
  const now = new Date();
  const executionToken = randomUUID();
  const encodedSnapshot = JSON.stringify(toPostgresJsonValue(input.sourceSnapshot)) ?? "null";
  const [row] = await prisma.$queryRaw<Array<ClaimOrReplayRow<R>>>(Prisma.sql`
    WITH prior AS MATERIALIZED (
      SELECT result
      FROM indexer_idempotency_records
      WHERE business_key = ${input.businessKey}
    ), inserted AS (
      INSERT INTO indexer_job_leases (
        id,
        business_key,
        queue_name,
        job_id,
        payload_generation,
        attempt,
        source_snapshot,
        decoder_generation,
        configuration_generation,
        deadline_at,
        execution_token,
        lease_version,
        last_progress_at,
        last_meaningful_progress_at,
        state,
        created_at,
        updated_at
      )
      SELECT
        ${randomUUID()},
        ${input.businessKey},
        ${input.queueName},
        ${input.job.id},
        ${input.payloadGeneration},
        1,
        ${encodedSnapshot}::jsonb,
        ${input.decoderGeneration ?? null},
        ${input.configurationGeneration ?? null},
        ${deadlineAt},
        ${executionToken},
        1,
        ${now},
        ${now},
        'running',
        ${now},
        ${now}
      WHERE NOT EXISTS (SELECT 1 FROM prior)
      ON CONFLICT (business_key) DO NOTHING
      RETURNING execution_token, deadline_at
    ), reclaimed AS (
      UPDATE indexer_job_leases AS lease
      SET
        queue_name = ${input.queueName},
        job_id = ${input.job.id},
        payload_generation = ${input.payloadGeneration},
        source_snapshot = ${encodedSnapshot}::jsonb,
        decoder_generation = COALESCE(${input.decoderGeneration ?? null}, lease.decoder_generation),
        configuration_generation = COALESCE(${input.configurationGeneration ?? null}, lease.configuration_generation),
        deadline_at = ${deadlineAt},
        execution_token = ${executionToken},
        last_progress_at = ${now},
        last_meaningful_progress_at = ${now},
        state = 'running',
        attempt = lease.attempt + 1,
        lease_version = lease.lease_version + 1,
        updated_at = ${now}
      WHERE lease.business_key = ${input.businessKey}
        AND NOT EXISTS (SELECT 1 FROM prior)
        AND NOT EXISTS (SELECT 1 FROM inserted)
        AND lease.state <> 'completed'
        AND (
          lease.state IN ('failed', 'expired', 'cancelled')
          OR lease.deadline_at <= ${now}
        )
      RETURNING execution_token, deadline_at
    ), claimed AS (
      SELECT execution_token, deadline_at FROM inserted
      UNION ALL
      SELECT execution_token, deadline_at FROM reclaimed
    )
    SELECT
      'completed'::text AS disposition,
      prior.result,
      NULL::text AS "executionToken",
      NULL::timestamptz AS "retryAt"
    FROM prior
    UNION ALL
    SELECT
      'claimed'::text,
      NULL::jsonb,
      claimed.execution_token,
      claimed.deadline_at
    FROM claimed
    UNION ALL
    SELECT
      'busy'::text,
      NULL::jsonb,
      NULL::text,
      lease.deadline_at
    FROM indexer_job_leases AS lease
    WHERE lease.business_key = ${input.businessKey}
      AND NOT EXISTS (SELECT 1 FROM prior)
      AND NOT EXISTS (SELECT 1 FROM claimed)
    LIMIT 1
  `);
  // ON CONFLICT can observe an uncommitted competing insert that is not visible
  // to this statement snapshot. Treat that rare empty result as a short busy
  // lease; the next delivery will see either its completion record or its lease.
  return row ?? {
    disposition: "busy",
    result: null,
    executionToken: null,
    retryAt: new Date(now.getTime() + 1_000),
  };
}
function createClaimedJobExecutionContext<T>(
  input: CreateJobExecutionContextInput<T>,
  deadlineAt: Date,
  executionToken: string,
): JobExecutionContext {
  const timeoutMs = Math.max(1, deadlineAt.getTime() - Date.now());
  const stallTimeoutMs = input.stallTimeoutMs == null
    ? null
    : Math.max(60_000, input.stallTimeoutMs);
  const controller = new AbortController();
  let abortClassification: "deadline" | "queue" | "stall" | "handler" = "handler";
  let lastMeaningfulProgressAt = new Date();
  let lastCheckpointWriteAt = Date.now();
  const abortFromQueue = () => {
    abortClassification = "queue";
    if (!controller.signal.aborted) controller.abort(input.job.signal.reason ?? new Error(`job cancelled by pg-boss for ${input.businessKey}`));
  };
  input.job.signal.addEventListener("abort", abortFromQueue, { once: true });
  const timer = setTimeout(() => {
    abortClassification = "deadline";
    if (!controller.signal.aborted) controller.abort(new Error(`job deadline exceeded for ${input.businessKey}`));
  }, timeoutMs);
  timer.unref?.();
  const stallTimer = stallTimeoutMs == null
    ? null
    : setInterval(() => {
        if (controller.signal.aborted) return;
        if (progressLeaseStalled(lastMeaningfulProgressAt, new Date(), stallTimeoutMs)) {
          abortClassification = "stall";
          controller.abort(new Error(`job stalled without meaningful progress for ${input.businessKey}`));
        }
      }, Math.max(15_000, Math.min(60_000, Math.floor(stallTimeoutMs / 4))));
  stallTimer?.unref?.();
  const finish = () => {
    clearTimeout(timer);
    if (stallTimer) clearInterval(stallTimer);
    input.job.signal.removeEventListener("abort", abortFromQueue);
  };
  return {
    businessKey: input.businessKey,
    signal: controller.signal,
    deadlineAt,
    touch() {
      if (!controller.signal.aborted) lastMeaningfulProgressAt = new Date();
    },
    async checkpoint(progress) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const nowMs = Date.now();
      const now = new Date(nowMs);
      lastMeaningfulProgressAt = now;
      // Lease creation already persists a fresh progress timestamp. Coalesce the
      // immediate phase marker and rapid loop checkpoints; long-running work still
      // persists progress once per interval and every update remains token-fenced.
      if (nowMs - lastCheckpointWriteAt < CHECKPOINT_WRITE_INTERVAL_MS) return;
      const updated = await prisma.indexerJobLease.updateMany({
        where: { businessKey: input.businessKey, executionToken, state: "running" },
        data: {
          progress: toPostgresJsonValue(progress) as never,
          lastProgressAt: now,
          lastMeaningfulProgressAt: now,
        },
      });
      if (updated.count !== 1) throw new BusinessExecutionLeaseLostError(input.businessKey);
      lastCheckpointWriteAt = nowMs;
    },
    async complete(result, options) {
      if (controller.signal.aborted && options?.allowAborted !== true) throw controller.signal.reason;
      const jsonResult = toPostgresJsonValue(result);
      const encodedResult = JSON.stringify(jsonResult ?? null);
      const digest = resultDigest(encodedResult);
      const completedAt = new Date();
      const [completion] = await prisma.$queryRaw<Array<{ completed: boolean }>>(Prisma.sql`
        WITH fenced AS (
          UPDATE indexer_job_leases
          SET
            state = 'completed',
            last_progress_at = ${completedAt},
            last_meaningful_progress_at = ${completedAt},
            progress = ${encodedResult}::jsonb,
            updated_at = ${completedAt}
          WHERE business_key = ${input.businessKey}
            AND execution_token = ${executionToken}
            AND state = 'running'
          RETURNING 1
        ), persisted AS (
          INSERT INTO indexer_idempotency_records (
            id,
            business_key,
            stage,
            result_digest,
            result,
            completed_at
          )
          SELECT
            ${randomUUID()},
            ${input.businessKey},
            ${input.queueName},
            ${digest},
            ${encodedResult}::jsonb,
            ${completedAt}
          FROM fenced
          ON CONFLICT (business_key) DO UPDATE SET
            stage = EXCLUDED.stage,
            result_digest = EXCLUDED.result_digest,
            result = EXCLUDED.result,
            materialization_generation = indexer_idempotency_records.materialization_generation + 1,
            completed_at = EXCLUDED.completed_at
          RETURNING 1
        )
        SELECT EXISTS (SELECT 1 FROM persisted) AS completed
      `);
      if (!completion?.completed) throw new BusinessExecutionLeaseLostError(input.businessKey);
      finish();
    },
    async fail(error) {
      finish();
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date();
      const state = controller.signal.aborted
        ? (abortClassification === "deadline" || abortClassification === "stall" ? "expired" : "cancelled")
        : "failed";
      const classification = controller.signal.aborted ? abortClassification : "handler";
      await prisma.$executeRaw(Prisma.sql`
        UPDATE indexer_job_leases AS lease
        SET
          state = ${state},
          last_progress_at = ${failedAt},
          error_history = (
            SELECT COALESCE(JSONB_AGG(entry ORDER BY ordinal), '[]'::jsonb)
            FROM (
              SELECT value AS entry, ordinal
              FROM (
                SELECT value, ordinal
                FROM JSONB_ARRAY_ELEMENTS(CASE
                  WHEN JSONB_TYPEOF(lease.error_history) = 'array' THEN lease.error_history
                  ELSE '[]'::jsonb
                END) WITH ORDINALITY AS history(value, ordinal)
                ORDER BY ordinal DESC
                LIMIT 31
              ) AS recent
              UNION ALL
              SELECT JSONB_BUILD_OBJECT(
                'error', ${message}::text,
                'at', ${failedAt.toISOString()}::text,
                'attempt', lease.attempt,
                'classification', ${classification}::text
              ), 9223372036854775807::bigint
            ) AS bounded(entry, ordinal)
          ),
          updated_at = ${failedAt}
        WHERE lease.business_key = ${input.businessKey}
          AND lease.execution_token = ${executionToken}
          AND lease.state = 'running'
      `);
    },
  };
}
export async function createOrReadJobExecutionContext<T, R>(
  input: CreateJobExecutionContextInput<T>,
): Promise<JobExecutionStart<R>> {
  const timeoutMs = Math.max(1_000, input.timeoutMs);
  const deadlineAt = new Date(Date.now() + timeoutMs);
  const start = await claimOrReadExecutionLease<T, R>(input, deadlineAt);
  if (start.disposition === "completed") {
    return { completed: true, result: start.result as R };
  }
  if (start.disposition !== "claimed" || !start.executionToken) {
    throw new BusinessExecutionInProgressError(
      input.businessKey,
      start.retryAt ?? new Date(Date.now() + 1_000),
    );
  }
  return {
    completed: false,
    context: createClaimedJobExecutionContext(input, deadlineAt, start.executionToken),
  };
}
