import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
import { registerIndexerSchedules } from "./register-schedules.js";
import { WORKER_SEMANTIC_GENERATION } from "./semantic-generation.js";
import { pruneIndexerExecutionHistory } from "./execution-history-prune.js";
const LEASE_KEY = "worker-scheduler";
const LEASE_MS = 90_000;
const RENEW_MS = 30_000;
const RECONCILE_MS = 5 * 60_000;
let coordinatorTimer: NodeJS.Timeout | null = null;
let ownerId: string | null = null;
let activeTick: Promise<void> | null = null;
let schedulesInstalled = false;
let lastReconciledAt = 0;
async function claimOrRenew(owner: string): Promise<boolean> {
  return withSerializableRetry(async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LEASE_MS);
    const rows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    INSERT INTO indexer_scheduler_leases
      (lease_key, owner_id, semantic_generation, lease_version, expires_at, acquired_at, updated_at)
    VALUES (
      ${LEASE_KEY}, ${owner}, ${WORKER_SEMANTIC_GENERATION}, 1, ${expiresAt}, ${now}, ${now}
    )
    ON CONFLICT (lease_key) DO UPDATE SET
      owner_id = EXCLUDED.owner_id,
      semantic_generation = EXCLUDED.semantic_generation,
      lease_version = indexer_scheduler_leases.lease_version + 1,
      expires_at = EXCLUDED.expires_at,
      updated_at = EXCLUDED.updated_at
    WHERE (
      indexer_scheduler_leases.owner_id = ${owner}
      OR indexer_scheduler_leases.expires_at <= ${now}
      OR indexer_scheduler_leases.semantic_generation <> EXCLUDED.semantic_generation
    )
    RETURNING TRUE AS acquired
    `;
    return rows[0]?.acquired === true;
  }, 8);
}
async function tick(boss: PgBoss): Promise<void> {
  const owner = ownerId;
  if (!owner) return;
  const leader = await claimOrRenew(owner);
  if (!leader) {
    schedulesInstalled = false;
    return;
  }
  if (!schedulesInstalled || Date.now() - lastReconciledAt >= RECONCILE_MS) {
    const enqueueStartupWork = !schedulesInstalled;
    await registerIndexerSchedules(boss, { enqueueStartupWork });
    await pruneIndexerExecutionHistory().catch((error) => {
      logger.warn(
        "indexer execution-history pruning failed",
        { error: error instanceof Error ? error.message : String(error) },
        "queue",
      );
    });
    schedulesInstalled = true;
    lastReconciledAt = Date.now();
  }
}
function runTick(boss: PgBoss): Promise<void> {
  if (activeTick) return activeTick;
  const promise = tick(boss).finally(() => {
    if (activeTick === promise) activeTick = null;
  });
  activeTick = promise;
  return promise;
}
function failRuntime(error: unknown): void {
  logger.error(
    "scheduler leadership/reconciliation failed",
    { error: error instanceof Error ? error.message : String(error) },
    "queue",
  );
  process.nextTick(() => {
    throw error;
  });
}
function scheduleNextTick(boss: PgBoss): void {
  if (!ownerId || coordinatorTimer) return;
  const jitteredDelay = Math.max(1_000, Math.round(RENEW_MS * (0.9 + Math.random() * 0.2)));
  coordinatorTimer = setTimeout(() => {
    coordinatorTimer = null;
    void runTick(boss).then(
      () => scheduleNextTick(boss),
      failRuntime,
    );
  }, jitteredDelay);
  coordinatorTimer.unref?.();
}
export async function startIndexerScheduleCoordinator(boss: PgBoss): Promise<void> {
  if (ownerId || coordinatorTimer || activeTick) return;
  ownerId = `${process.env.WORKER_REPLICA_ID?.trim() || process.env.HOSTNAME?.trim() || "worker"}:${process.pid}:${randomUUID()}`;
  try {
    await runTick(boss);
    scheduleNextTick(boss);
  } catch (error) {
    try {
      await stopIndexerScheduleCoordinator();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Indexer schedule coordinator startup and cleanup failed",
      );
    }
    throw error;
  }
}
export async function stopIndexerScheduleCoordinator(): Promise<void> {
  if (coordinatorTimer) clearTimeout(coordinatorTimer);
  coordinatorTimer = null;
  const owner = ownerId;
  ownerId = null;
  schedulesInstalled = false;
  lastReconciledAt = 0;
  const results = await Promise.allSettled([
    activeTick ?? Promise.resolve(),
    owner
      ? prisma.indexerSchedulerLease.deleteMany({ where: { leaseKey: LEASE_KEY, ownerId: owner } })
      : Promise.resolve(),
  ]);
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (errors.length > 0) {
    throw new AggregateError(errors, "Indexer schedule coordinator shutdown failed");
  }
}
