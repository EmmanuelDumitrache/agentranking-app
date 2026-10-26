import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

const LEASE_TTL_MS = 15 * 60 * 1_000;
const HEARTBEAT_MS = 60 * 1_000;

export class MetaplexAttemptLeaseLostError extends Error {
  readonly attemptId: string;
  constructor(attemptId: string, cause?: unknown) {
    super("The Metaplex launch execution lease was lost.", { cause });
    this.name = "MetaplexAttemptLeaseLostError";
    this.attemptId = attemptId;
  }
}

export class MetaplexAttemptBusyError extends Error {
  readonly attemptId: string;
  constructor(attemptId: string) {
    super("This Metaplex launch attempt is already being processed.");
    this.name = "MetaplexAttemptBusyError";
    this.attemptId = attemptId;
  }
}

function leaseExpiry(now = Date.now()): Date {
  return new Date(now + LEASE_TTL_MS);
}

/**
 * Durable, cross-process execution lease for a single launch attempt. The lease
 * lives in PostgreSQL rather than Valkey because it guards irreversible chain
 * mutations. It automatically expires after a crashed process and is renewed
 * while the pipeline remains active.
 */
export async function withMetaplexAttemptExecutionLease<T>(
  attemptId: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const token = randomUUID();
  const now = new Date();
  const acquired = await prisma.metaplexLaunchAttempt.updateMany({
    where: {
      id: attemptId,
      OR: [
        { processingLeaseToken: null },
        { processingLeaseExpiresAt: null },
        { processingLeaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      processingLeaseToken: token,
      processingLeaseExpiresAt: leaseExpiry(now.getTime()),
    },
  });
  if (acquired.count !== 1) throw new MetaplexAttemptBusyError(attemptId);

  const leaseLost = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const activeHeartbeats = new Set<Promise<void>>();
  const scheduleHeartbeat = (): void => {
    if (stopped || leaseLost.signal.aborted) return;
    timer = setTimeout(() => {
      timer = null;
      const heartbeat = prisma.metaplexLaunchAttempt
        .updateMany({
          where: { id: attemptId, processingLeaseToken: token },
          data: { processingLeaseExpiresAt: leaseExpiry() },
        })
        .then((result) => {
          if (result.count !== 1 && !leaseLost.signal.aborted) {
            leaseLost.abort(new MetaplexAttemptLeaseLostError(attemptId));
          }
        })
        .catch((error) => {
          if (!leaseLost.signal.aborted) {
            leaseLost.abort(new MetaplexAttemptLeaseLostError(attemptId, error));
          }
        });
      activeHeartbeats.add(heartbeat);
      void heartbeat.finally(() => {
        activeHeartbeats.delete(heartbeat);
        scheduleHeartbeat();
      });
    }, HEARTBEAT_MS);
    timer.unref?.();
  };
  scheduleHeartbeat();

  try {
    const result = await operation(leaseLost.signal);
    if (leaseLost.signal.aborted) {
      throw leaseLost.signal.reason instanceof Error
        ? leaseLost.signal.reason
        : new MetaplexAttemptLeaseLostError(attemptId, leaseLost.signal.reason);
    }
    return result;
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    await Promise.allSettled([...activeHeartbeats]);
    await prisma.metaplexLaunchAttempt
      .updateMany({
        where: { id: attemptId, processingLeaseToken: token },
        data: { processingLeaseToken: null, processingLeaseExpiresAt: null },
      })
      .catch((error) => {
        console.error("[metaplex] failed to release attempt execution lease", {
          attemptId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}
