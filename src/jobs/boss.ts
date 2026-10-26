import { PgBoss } from "pg-boss";
import {
  acquirePgBossRuntimeLock,
  type PgBossAdvisoryLock,
} from "./pg-boss-deployment-lock";
import {
  applyApplicationQueuePolicies,
  registerApplicationQueues,
} from "./register-queues";
type BossRole = "producer" | "worker";
export type StopJobBossOptions = {
  readonly gracefulTimeoutMs?: number;
  readonly forcedCloseTimeoutMs?: number;
};
const DEFAULT_GRACEFUL_STOP_TIMEOUT_MS = 30_000;
const DEFAULT_FORCED_CLOSE_TIMEOUT_MS = 5_000;
const PGBOSS_QUEUE_CACHE_INTERVAL_SECONDS = 5 * 60;
let bossPromise: Promise<PgBoss> | null = null;
let activeRole: BossRole | null = null;
let runtimeLock: PgBossAdvisoryLock | null = null;
const stoppingBosses = new WeakSet<PgBoss>();
function pgBossEventError(error: unknown): string {
  if (Error.isError(error)) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(error);
}
function isExpectedShutdownEvent(error: unknown): boolean {
  return /database connection is not opened|connection (?:is )?closed|client was closed/i.test(
    pgBossEventError(error),
  );
}
function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL!.trim();
  if (value.startsWith("file:")) {
    throw new Error("pg-boss requires PostgreSQL; SQLite DATABASE_URL is unsupported");
  }
  return value;
}
function pgBossAutoMigrateEnabled(): boolean {
  const configured = process.env.PGBOSS_AUTO_MIGRATE?.trim();
  return configured === "1" || (configured !== "0" && process.env.NODE_ENV !== "production");
}
function strictPoolMaximum(role: BossRole): number {
  const name =
    role === "worker"
      ? "APPLICATION_PGBOSS_WORKER_POOL_MAX"
      : "APPLICATION_PGBOSS_PRODUCER_POOL_MAX";
  const fallback = role === "worker" ? 4 : 3;
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`${name} must be a complete positive integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 100) {
    throw new Error(`${name} must be between 1 and 100`);
  }
  return parsed;
}
function createBoss(role: BossRole): PgBoss {
  const isWorker = role === "worker";
  const autoMigrate = pgBossAutoMigrateEnabled();
  const boss = new PgBoss({
    connectionString: requireDatabaseUrl(),
    application_name: `agentranking-pg-boss-${role}`,
    schema: "pgboss",
    max: strictPoolMaximum(role),
    connectionTimeoutMillis: 20_000,
    useListenNotify: isWorker,
    schedule: isWorker,
    // The indexer pg-boss instance is the sole supervisor for this shared schema.
    supervise: false,
    queueCacheIntervalSeconds: PGBOSS_QUEUE_CACHE_INTERVAL_SECONDS,
    migrate: autoMigrate,
    createSchema: autoMigrate,
    warningSlowQuerySeconds: 10,
    persistWarnings: isWorker,
    warningRetentionDays: 30,
    // Queue statistics are persisted by the indexer's sole schema supervisor.
    persistQueueStats: false,
    queueStatRetentionDays: 14,
  });
  boss.on("error", (error) => {
    if (stoppingBosses.has(boss) && isExpectedShutdownEvent(error)) {
      console.info(`[pg-boss:${role}] connection closed during shutdown`, pgBossEventError(error));
      return;
    }
    console.error(`[pg-boss:${role}]`, error);
  });
  boss.on("warning", (warning) => console.warn(`[pg-boss:${role}] warning`, warning));
  return boss;
}
async function closeFailedBoss(boss: PgBoss, role: BossRole): Promise<void> {
  stoppingBosses.add(boss);
  await boss.stop({ graceful: false, close: true, timeout: 5_000 }).catch((error) => {
    console.error(`[pg-boss:${role}] failed startup cleanup`, error);
  });
}
async function startBoss(role: BossRole): Promise<PgBoss> {
  if (bossPromise) {
    if (activeRole !== role && role === "worker") {
      throw new Error(
        `pg-boss already started in ${activeRole} role; worker role must initialize first`,
      );
    }
    return bossPromise;
  }
  activeRole = role;
  bossPromise = (async () => {
    const boss = createBoss(role);
    const autoMigrate = pgBossAutoMigrateEnabled();
    const lock = await acquirePgBossRuntimeLock(`application-${role}`);
    try {
      await boss.start();
      if (autoMigrate) await applyApplicationQueuePolicies(boss);
      else await registerApplicationQueues(boss);
      runtimeLock = lock;
      return boss;
    } catch (error) {
      await closeFailedBoss(boss, role);
      await lock.release().catch((lockError) => {
        console.error(`[pg-boss:${role}] deployment lock cleanup failed`, lockError);
      });
      if (!autoMigrate) {
        const detail = Error.isError(error) ? error.message : String(error);
        throw new Error(
          `pg-boss schema or application queue policies are unavailable: ${detail}`,
          { cause: error },
        );
      }
      throw error;
    }
  })().catch((error) => {
    activeRole = null;
    bossPromise = null;
    runtimeLock = null;
    throw error;
  });
  return bossPromise;
}
export function getJobProducer(): Promise<PgBoss> {
  return startBoss("producer");
}
export function getJobWorkerBoss(): Promise<PgBoss> {
  return startBoss("worker");
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
export async function stopJobBoss(options: StopJobBossOptions = {}): Promise<void> {
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
  const role = activeRole ?? "worker";
  bossPromise = null;
  activeRole = null;
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
    console.warn(`[pg-boss:${role}] graceful shutdown failed; forcing connection close`, {
      gracefulTimeoutMs,
      error: gracefulError,
    });
    const forcedCloseError = await captureFailure(boss.stop({
      graceful: false,
      close: true,
      timeout: forcedCloseTimeoutMs,
    }));
    if (forcedCloseError != null) {
      shutdownErrors.push(new AggregateError(
        [gracefulError, forcedCloseError],
        "application pg-boss graceful and forced shutdown failed",
      ));
    }
  }
  await lock?.release().catch((error) => shutdownErrors.push(error));
  if (shutdownErrors.length > 0) {
    throw new AggregateError(shutdownErrors, "application pg-boss shutdown failed");
  }
}
