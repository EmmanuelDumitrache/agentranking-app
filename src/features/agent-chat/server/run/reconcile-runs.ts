import { prisma } from "@/lib/db";
import { settleRun } from "./settle-run";
import * as telemetry from "../telemetry";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
export type ReconcileRunsResult = {
  inspected: number;
  settled: number;
  failed: number;
};
const CLAIM_LEASE_MS = 60_000;
const ABORT_GRACE_MS = 30_000;
async function claimStaleRuns(
  now: Date,
  take: number,
): Promise<Array<{ runId: string; abortRequestedAt: Date | null }>> {
  const workerId = `reconciler:${crypto.randomUUID()}`;
  const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
  const abortCutoff = new Date(now.getTime() - ABORT_GRACE_MS);
  return prisma.$transaction(
    async (tx) => tx.$queryRaw<
      Array<{ runId: string; abortRequestedAt: Date | null }>
    >`
    WITH candidates AS (
      SELECT runtime.run_id
      FROM agent_chat_run_runtime runtime
      JOIN agent_chat_runs run ON run.id = runtime.run_id
      WHERE run.status IN ('PREPARING', 'RESERVED', 'STREAMING')
        AND run.settlement_status = 'PENDING'
        AND (
          runtime.lease_expires_at < ${now}
          OR (runtime.abort_requested_at IS NOT NULL AND runtime.abort_requested_at < ${abortCutoff})
        )
      ORDER BY runtime.lease_expires_at ASC, runtime.run_id ASC
      LIMIT ${take}
      FOR UPDATE OF runtime SKIP LOCKED
    )
    UPDATE agent_chat_run_runtime runtime
    SET worker_id = ${workerId}, heartbeat_at = ${now}, lease_expires_at = ${leaseUntil}, updated_at = ${now}
    FROM candidates
    WHERE runtime.run_id = candidates.run_id
    RETURNING runtime.run_id AS "runId", runtime.abort_requested_at AS "abortRequestedAt"
  `,
  );
}
export async function reconcileStaleRuns(
  now = new Date(),
): Promise<ReconcileRunsResult> {
  const claims = await claimStaleRuns(now, 100);
  const runs = claims.length
    ? await prisma.agentChatRun.findMany({
        where: { id: { in: claims.map((claim) => claim.runId) } },
        select: { id: true, conversationId: true, initialModelKey: true },
      })
    : [];
  const abortByRun = new Map(
    claims.map((claim) => [claim.runId, claim.abortRequestedAt]),
  );
  let settled = 0;
  let failed = 0;
  for (const run of runs) {
    const cancelled = abortByRun.get(run.id) != null;
    try {
      await settleRun(run.id, cancelled ? "CANCELLED" : "FAILED", {
        errorCode: cancelled ? "REQUEST_CANCELLED" : "STALE_RUN_RECOVERED",
        errorMessage: cancelled
          ? "Cancellation reconciled after the stream stopped"
          : "Stale run reconciled after its execution lease expired",
      });
      await telemetry.trackRunFailed({
        runId: run.id,
        threadId: run.conversationId,
        provider: "reconciler",
        model: run.initialModelKey,
        errorCode: cancelled ? "REQUEST_CANCELLED" : "STALE_RUN_RECOVERED",
      });
      settled += 1;
    } catch (error) {
      failed += 1;
      console.error("[agent-chat] stale run reconciliation failed", {
        runId: run.id,
        error: safeErrorDetails(error),
      });
    }
  }
  return { inspected: claims.length, settled, failed };
}