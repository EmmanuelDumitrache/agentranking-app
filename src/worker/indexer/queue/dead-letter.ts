import type { JobResult, JobWithMetadata, PgBoss, SendOptions } from "pg-boss";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { INDEXER_QUEUES } from "./queues.js";
import { redactDiagnosticValue } from "../lib/secret-redaction.js";
import { createCompletionLogLimiter } from "../../job-completion-log.js";

const deadLetterLog = createCompletionLogLimiter();
function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function sourceCoordinates(payload: unknown): unknown {
  const record = asRecord(payload);
  return record.sourceSnapshot ?? {
    chainId: record.chainId,
    agentId: record.agentId,
    requestedGeneration: record.requestedGeneration,
  };
}
function payloadGeneration(payload: unknown): number | null {
  const value = asRecord(payload).v;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
function latestErrorHistoryEntry(value: unknown): unknown {
  return Array.isArray(value) ? value.at(-1) : value;
}
export async function registerDeadLetterWorker(boss: PgBoss): Promise<void> {
  await boss.work<unknown>(
    INDEXER_QUEUES.DEAD_LETTER,
    {
      includeMetadata: true,
      localConcurrency: 1,
      batchSize: 50,
      perJobResults: true,
      burstWhenBatchFull: true,
      priority: false,
      orderByCreatedOn: false,
      pollingIntervalSeconds: 5,
      heartbeatRefreshSeconds: 30,
    },
    async (jobs) => {
      const batch = jobs as JobWithMetadata<unknown>[];
      const sourceIds = [...new Set(
        batch.flatMap((job) => job.sourceId == null ? [] : [job.sourceId]),
      )];
      const leases = sourceIds.length === 0
        ? []
        : await prisma.indexerJobLease.findMany({
            where: { jobId: { in: sourceIds } },
            // The existing (job_id, created_at) index can satisfy this order;
            // ordering by the frequently-mutated updated_at forced a batch sort.
            orderBy: { createdAt: "desc" },
            select: {
              jobId: true,
              errorHistory: true,
              decoderGeneration: true,
              configurationGeneration: true,
            },
          });
      const leaseByJobId = new Map<string, (typeof leases)[number]>();
      for (const lease of leases) {
        if (lease.jobId != null && !leaseByJobId.has(lease.jobId)) {
          leaseByJobId.set(lease.jobId, lease);
        }
      }
      const records = batch.map((job) => {
        const lease = job.sourceId == null ? null : leaseByJobId.get(job.sourceId) ?? null;
        return {
          deadLetterJobId: job.id,
          originalQueue: job.sourceName ?? "unknown",
          originalJobId: job.sourceId,
          originalPayload: redactDiagnosticValue(job.data) as never,
          payloadGeneration: payloadGeneration(job.data),
          firstAttemptAt: job.sourceCreatedOn,
          lastAttemptAt: job.startedOn,
          retryCount: job.sourceRetryCount ?? job.retryCount,
          errorHistory: redactDiagnosticValue(lease?.errorHistory ?? job.output) as never,
          sourceNetwork: asRecord(job.data).chainId == null ? null : String(asRecord(job.data).chainId),
          sourceCoordinates: redactDiagnosticValue(sourceCoordinates(job.data)) as never,
          decoderGeneration: lease?.decoderGeneration,
          configurationGeneration: lease?.configurationGeneration,
          status: "pending",
        };
      });
      try {
        // A dead-letter job id is immutable. Retries can safely skip the row
        // already persisted by an earlier attempt, collapsing fifty upserts
        // into one insert statement on failure storms.
        await prisma.indexerDeadLetterRecord.createMany({
          data: records,
          skipDuplicates: true,
        });
        for (const job of batch) {
          const originalQueue = job.sourceName ?? "unknown";
          const lease = job.sourceId == null ? null : leaseByJobId.get(job.sourceId) ?? null;
          const summary = deadLetterLog(originalQueue);
          if (summary) {
            logger.error("indexer job dead-lettered", {
              ...summary,
              latestDeadLetterJobId: job.id,
              originalQueue,
              latestOriginalJobId: job.sourceId,
              retryCount: job.sourceRetryCount ?? job.retryCount,
              firstAttemptAt: job.sourceCreatedOn,
              latestError: redactDiagnosticValue(
                latestErrorHistoryEntry(lease?.errorHistory ?? job.output),
              ),
            }, "queue");
          }
        }
        return batch.map((job): JobResult => ({ id: job.id, status: "completed" }));
      } catch (error) {
        const output = redactDiagnosticValue(
          error instanceof Error ? error.message : String(error),
        );
        return batch.map((job): JobResult => ({
          id: job.id,
          status: "failed",
          output,
        }));
      }
    },
  );
}
export async function redriveDeadLetter(input: {
  deadLetterJobId: string;
  boss: PgBoss;
  options?: Partial<Pick<SendOptions, "priority" | "startAfter">>;
  decoderGeneration?: string;
  configurationGeneration?: string;
  operatorOverride?: boolean;
}): Promise<string> {
  const record = await prisma.indexerDeadLetterRecord.findUnique({ where: { deadLetterJobId: input.deadLetterJobId } });
  if (!record) throw new Error(`dead-letter record not found: ${input.deadLetterJobId}`);
  if (record.originalQueue === "unknown" || record.originalQueue === INDEXER_QUEUES.DEAD_LETTER) {
    throw new Error(`dead-letter record ${input.deadLetterJobId} has no replayable original queue`);
  }
  const decoderGeneration = input.decoderGeneration?.trim() || process.env.INDEXER_DECODER_GENERATION?.trim() || "worker-protocol-v12";
  const configurationGeneration = input.configurationGeneration?.trim() || process.env.INDEXER_CONFIGURATION_GENERATION?.trim() || "runtime-config-v1";
  const generationUnknown = record.decoderGeneration == null && record.configurationGeneration == null;
  const generationChanged = !generationUnknown && (decoderGeneration !== record.decoderGeneration || configurationGeneration !== record.configurationGeneration);
  if (record.replayGeneration > 0 && (generationUnknown || !generationChanged) && !input.operatorOverride) {
    throw new Error(
      `dead-letter record ${input.deadLetterJobId} was already replayed under the same decoder/configuration generation; ` +
      "upgrade the decoder, correct configuration, or use an explicit operator override",
    );
  }
  const replayGeneration = record.replayGeneration + 1;
  const id = await input.boss.send(record.originalQueue, record.originalPayload as object, {
    ...input.options,
    singletonKey: `redrive:${record.deadLetterJobId}:${replayGeneration}`,
  });
  if (!id) throw new Error(`pg-boss suppressed dead-letter redrive for ${record.deadLetterJobId}`);
  await prisma.indexerDeadLetterRecord.update({
    where: { deadLetterJobId: record.deadLetterJobId },
    data: { replayGeneration, status: "replayed" },
  });
  return id;
}
