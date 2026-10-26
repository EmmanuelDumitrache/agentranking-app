import { prisma } from "../db.js";
import { redactSensitiveText } from "../lib/secret-redaction.js";
import { INDEXER_QUEUES } from "./queues.js";

const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const FAILURE_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;
const RECENT_FAILURE_LIMIT = 5;
const FAILURE_PRUNE_BATCH = 10_000;
const MAX_MESSAGE_LENGTH = 1_000;
const MAX_REASON_LENGTH = 300;
const MAX_JOB_ID_LENGTH = 200;

export type AgentSyncHealthProjection = {
  available: true;
  failureSemantics: "attempts";
  failureWindowHours: 24;
  lastCompletedAt: string | null;
  lastCompletedStatus: string | null;
  lastCompletedReason: string | null;
  lastFailedAt: string | null;
  failedAttemptsLast24h: number;
  recentErrors: Array<{
    lastError: string | null;
    updatedAt: string;
  }>;
};

function sanitiseText(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  const raw = value instanceof Error ? value.message : String(value);
  const sanitised = redactSensitiveText(raw).trim();
  return sanitised ? sanitised.slice(0, maxLength) : null;
}

export async function recordAgentSyncCompleted(input: {
  completedAt?: Date;
  status?: string;
  reason?: string;
}): Promise<void> {
  const completedAt = input.completedAt ?? new Date();
  await prisma.workerQueueHealth.upsert({
    where: { queueName: INDEXER_QUEUES.AGENT_SYNC },
    create: {
      queueName: INDEXER_QUEUES.AGENT_SYNC,
      lastCompletedAt: completedAt,
      lastCompletedStatus: sanitiseText(input.status, MAX_REASON_LENGTH),
      lastCompletedReason: sanitiseText(input.reason, MAX_REASON_LENGTH),
    },
    update: {
      lastCompletedAt: completedAt,
      lastCompletedStatus: sanitiseText(input.status, MAX_REASON_LENGTH),
      lastCompletedReason: sanitiseText(input.reason, MAX_REASON_LENGTH),
    },
  });
}

export async function recordAgentSyncFailure(input: {
  error: unknown;
  failedAt?: Date;
  jobId?: string;
}): Promise<void> {
  const failedAt = input.failedAt ?? new Date();
  const message = sanitiseText(input.error, MAX_MESSAGE_LENGTH);
  const jobId = sanitiseText(input.jobId, MAX_JOB_ID_LENGTH);
  const pruneClaimBefore = new Date(failedAt.getTime() - FAILURE_PRUNE_INTERVAL_MS);
  const retentionCutoff = new Date(failedAt.getTime() - FAILURE_WINDOW_MS);

  await prisma.$transaction(async (tx) => {
    const health = await tx.workerQueueHealth.upsert({
      where: { queueName: INDEXER_QUEUES.AGENT_SYNC },
      create: {
        queueName: INDEXER_QUEUES.AGENT_SYNC,
        lastFailedAt: failedAt,
        lastFailureMessage: message,
        lastFailurePrunedAt: failedAt,
      },
      update: {
        lastFailedAt: failedAt,
        lastFailureMessage: message,
      },
    });

    await tx.workerQueueFailure.create({
      data: {
        queueName: INDEXER_QUEUES.AGENT_SYNC,
        jobId,
        message,
        failedAt,
      },
    });

    if (
      health.lastFailurePrunedAt == null ||
      health.lastFailurePrunedAt.getTime() < pruneClaimBefore.getTime()
    ) {
      const claimed = await tx.workerQueueHealth.updateMany({
        where: {
          queueName: INDEXER_QUEUES.AGENT_SYNC,
          OR: [
            { lastFailurePrunedAt: null },
            { lastFailurePrunedAt: { lt: pruneClaimBefore } },
          ],
        },
        data: { lastFailurePrunedAt: failedAt },
      });
      if (claimed.count === 1) {
        await tx.$executeRaw`
          WITH protected AS MATERIALIZED (
            SELECT id
            FROM worker_queue_failures
            WHERE queue_name = ${INDEXER_QUEUES.AGENT_SYNC}
            ORDER BY failed_at DESC, id DESC
            LIMIT ${RECENT_FAILURE_LIMIT}
          ), doomed AS MATERIALIZED (
            SELECT failure.id
            FROM worker_queue_failures AS failure
            WHERE failure.queue_name = ${INDEXER_QUEUES.AGENT_SYNC}
              AND failure.failed_at < ${retentionCutoff}
              AND NOT EXISTS (
                SELECT 1 FROM protected WHERE protected.id = failure.id
              )
            ORDER BY failure.failed_at ASC, failure.id ASC
            LIMIT ${FAILURE_PRUNE_BATCH}
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM worker_queue_failures AS failure
          USING doomed
          WHERE failure.id = doomed.id
        `;
      }
    }
  });
}

export async function readAgentSyncHealthProjection(
  now = new Date(),
): Promise<AgentSyncHealthProjection> {
  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS);
  const [health, failedAttemptsLast24h, recentFailures] = await prisma.$transaction([
    prisma.workerQueueHealth.findUnique({
      where: { queueName: INDEXER_QUEUES.AGENT_SYNC },
      select: {
        lastCompletedAt: true,
        lastCompletedStatus: true,
        lastCompletedReason: true,
        lastFailedAt: true,
      },
    }),
    prisma.workerQueueFailure.count({
      where: {
        queueName: INDEXER_QUEUES.AGENT_SYNC,
        failedAt: { gte: windowStart },
      },
    }),
    prisma.workerQueueFailure.findMany({
      where: { queueName: INDEXER_QUEUES.AGENT_SYNC },
      orderBy: [{ failedAt: "desc" }, { id: "desc" }],
      take: RECENT_FAILURE_LIMIT,
      select: { message: true, failedAt: true },
    }),
  ]);

  return {
    available: true,
    failureSemantics: "attempts",
    failureWindowHours: 24,
    lastCompletedAt: health?.lastCompletedAt?.toISOString() ?? null,
    lastCompletedStatus: health?.lastCompletedStatus ?? null,
    lastCompletedReason: health?.lastCompletedReason ?? null,
    lastFailedAt: health?.lastFailedAt?.toISOString() ?? null,
    failedAttemptsLast24h,
    recentErrors: recentFailures.map((failure) => ({
      lastError: failure.message,
      updatedAt: failure.failedAt.toISOString(),
    })),
  };
}
