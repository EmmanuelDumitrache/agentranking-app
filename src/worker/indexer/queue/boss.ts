import { PgBoss } from "pg-boss";
import {
  acquirePgBossRuntimeLock,
  type PgBossAdvisoryLock,
} from "../../../jobs/pg-boss-deployment-lock.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { resolvedWorkerDatabaseUrl, workerPrismaPoolSize } from "../db.js";
import {
  applyIndexerQueuePolicies,
  registerIndexerQueues,
} from "./register-queues.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
export type StopIndexerBossOptions = {
  readonly gracefulTimeoutMs?: number;
  readonly forcedCloseTimeoutMs?: number;
};
const DEFAULT_GRACEFUL_STOP_TIMEOUT_MS = 30_000;
const DEFAULT_FORCED_CLOSE_TIMEOUT_MS = 5_000;
const PGBOSS_SUPERVISE_INTERVAL_SECONDS = 5 * 60;
// pg-boss otherwise defaults deletion maintenance to 24 hours. At fan-out
// volume that defeats short delete-after policies and leaves every claim and
// monitoring query walking a full day of already-completed jobs.
const PGBOSS_MAINTENANCE_INTERVAL_SECONDS = 10 * 60;
// Queue monitoring groups the whole pg-boss job table. Hourly snapshots retain
// operational trend data without repeatedly aggregating a six-figure backlog.
const PGBOSS_MONITOR_INTERVAL_SECONDS = 60 * 60;
const PGBOSS_QUEUE_CACHE_INTERVAL_SECONDS = 5 * 60;
function pgBossEventError(error: unknown): string {
  if (Error.isError(error)) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
    const code = Reflect.get(error, "code");
    const name = Reflect.get(error, "name");
    const parts = [name, code].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (parts.length > 0) return parts.join(": ");
    try {
      return JSON.stringify(error) ?? Object.prototype.toString.call(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}
let bossPromise: Promise<PgBoss> | null = null;
let runtimeLock: PgBossAdvisoryLock | null = null;
const stoppingBosses = new WeakSet<PgBoss>();
function isExpectedShutdownEvent(error: unknown): boolean {
  const detail = pgBossEventError(error);
  return /database connection is not opened|connection (?:is )?closed|client was closed/i.test(detail);
}
function pgBossAutoMigrateEnabled(): boolean {
  const configured = process.env.WORKER_PGBOSS_AUTO_MIGRATE?.trim();
  return configured === "1" || (configured !== "0" && process.env.NODE_ENV !== "production");
}
function createBoss(): PgBoss {
  const autoMigrate = pgBossAutoMigrateEnabled();
  const boss = new PgBoss({
    connectionString: resolvedWorkerDatabaseUrl,
    application_name: "agentranking-worker-pg-boss",
    schema: "pgboss",
    max: parseOptionalStrictUnsignedInteger(
      process.env.WORKER_PGBOSS_POOL_MAX,
      "WORKER_PGBOSS_POOL_MAX",
      Math.max(3, Math.min(12, Math.ceil(workerPrismaPoolSize / 4) + 2)),
      { maximum: 100 },
    ),
    connectionTimeoutMillis: 20_000,
    useListenNotify: true,
    // The application pg-boss instance is the sole timekeeper for this shared schema.
    schedule: false,
    supervise: true,
    superviseIntervalSeconds: PGBOSS_SUPERVISE_INTERVAL_SECONDS,
    maintenanceIntervalSeconds: PGBOSS_MAINTENANCE_INTERVAL_SECONDS,
    monitorIntervalSeconds: PGBOSS_MONITOR_INTERVAL_SECONDS,
    queueCacheIntervalSeconds: PGBOSS_QUEUE_CACHE_INTERVAL_SECONDS,
    migrate: autoMigrate,
    createSchema: autoMigrate,
    warningSlowQuerySeconds: 10,
    warningQueueSize: 1_000,
    persistWarnings: true,
    warningRetentionDays: 30,
    persistQueueStats: true,
    queueStatRetentionDays: 14,
  });
  boss.on("error", (error) => {
    if (stoppingBosses.has(boss) && isExpectedShutdownEvent(error)) {
      logger.info(
        "pg-boss connection closed during shutdown",
        { error: pgBossEventError(error) },
        "queue",
      );
      return;
    }
    logger.error(
      "pg-boss error",
      { error: pgBossEventError(error) },
      "queue",
    );
  });
  boss.on("warning", (warning) => {
    logger.warn("pg-boss warning", { warning }, "queue");
  });
  return boss;
}
async function closeFailedBoss(boss: PgBoss): Promise<void> {
  stoppingBosses.add(boss);
  await boss.stop({ graceful: false, close: true, timeout: 5_000 }).catch((error) => {
    logger.error(
      "pg-boss failed startup cleanup",
      { error: Error.isError(error) ? error.message : String(error) },
      "queue",
    );
  });
}
export async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = createBoss();
      const autoMigrate = pgBossAutoMigrateEnabled();
      const lock = await acquirePgBossRuntimeLock("indexer-worker");
      try {
        await boss.start();
        if (autoMigrate) {
          await applyIndexerQueuePolicies(boss);
        } else {
          await registerIndexerQueues(boss);
        }
        runtimeLock = lock;
        return boss;
      } catch (error) {
        await closeFailedBoss(boss);
        await lock.release().catch((lockError) => {
          logger.error(
            "pg-boss runtime lock cleanup failed",
            { error: Error.isError(lockError) ? lockError.message : String(lockError) },
            "queue",
          );
        });
        if (!autoMigrate) {
          const detail = Error.isError(error) ? error.message : String(error);
          throw new Error(
            `pg-boss schema or indexer queue policies are unavailable: ${detail}`,
            { cause: error },
          );
        }
        throw error;
      }
    })().catch((error) => {
      bossPromise = null;
      runtimeLock = null;
      throw error;
    });
  }
  return bossPromise;
}
async function captureFailure(operation: Promise<unknown>): Promise<unknown | null> {
  try {
    await operation;
    return null;
  } catch (error) {
    return error;
  }
}
function positiveTimeout(value: number | undefined, fallback: number, name: string): number {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}
export async function stopBoss(options: StopIndexerBossOptions = {}): Promise<void> {
  const gracefulTimeoutMs = positiveTimeout(
    options.gracefulTimeoutMs,
    DEFAULT_GRACEFUL_STOP_TIMEOUT_MS,
    "gracefulTimeoutMs",
  );
  const forcedCloseTimeoutMs = positiveTimeout(
    options.forcedCloseTimeoutMs,
    DEFAULT_FORCED_CLOSE_TIMEOUT_MS,
    "forcedCloseTimeoutMs",
  );
  const current = bossPromise;
  bossPromise = null;
  if (!current) {
    const lock = runtimeLock;
    runtimeLock = null;
    await lock?.release();
    return;
  }
  const boss = await current;
  stoppingBosses.add(boss);
  const lock = runtimeLock;
  runtimeLock = null;
  const shutdownErrors: unknown[] = [];
  const gracefulError = await captureFailure(boss.stop({
    graceful: true,
    close: true,
    timeout: gracefulTimeoutMs,
  }));
  if (gracefulError != null) {
    logger.warn(
      "pg-boss graceful shutdown failed; forcing connection close",
      {
        gracefulTimeoutMs,
        error: Error.isError(gracefulError) ? gracefulError.message : String(gracefulError),
      },
      "queue",
    );
    const forcedCloseError = await captureFailure(boss.stop({
      graceful: false,
      close: true,
      timeout: forcedCloseTimeoutMs,
    }));
    if (forcedCloseError != null) {
      shutdownErrors.push(new AggregateError(
        [gracefulError, forcedCloseError],
        "indexer pg-boss graceful and forced shutdown failed",
      ));
    }
  }
  await lock?.release().catch((error) => shutdownErrors.push(error));
  if (shutdownErrors.length > 0) {
    throw new AggregateError(shutdownErrors, "indexer pg-boss shutdown failed");
  }
}
