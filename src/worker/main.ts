import { startApplicationJobRuntime, stopApplicationJobRuntime } from "./application/runtime";
import { getJobWorkerBoss } from "../jobs/boss";
import { prisma as indexerPrisma } from "./indexer/db.js";
import {
  startIndexerQueueRuntime,
  stopIndexerQueueRuntime,
} from "./indexer/queue/runtime.js";
import { settleWithin } from "./settle-within";
import { startCacheInvalidationDispatcher, type CacheInvalidationDispatcher } from "./cache-invalidation-dispatcher";
import { migratePgBossForDeployment } from "./pg-boss-deployment-migration";
import { WORKER_SHUTDOWN_POLICY } from "./shutdown-policy";
const PGBOSS_MIGRATION_FLAG = "--migrate-pg-boss";
type ShutdownPhase = {
  readonly name: string;
  readonly operation: () => Promise<unknown>;
};
function shutdownFailure(phase: string, error: unknown): Error {
  return new Error(`${phase} failed`, { cause: error });
}
async function runShutdownPhase(
  phase: ShutdownPhase,
  failures: unknown[],
): Promise<void> {
  const startedAt = Date.now();
  try {
    await phase.operation();
    console.info("[jobs] shutdown phase complete", {
      phase: phase.name,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    failures.push(shutdownFailure(phase.name, error));
    console.error("[jobs] shutdown phase failed", {
      phase: phase.name,
      durationMs: Date.now() - startedAt,
      error,
    });
  }
}
async function runWorker(): Promise<void> {
  const startTime = Date.now();
  let shutdownPromise: Promise<void> | null = null;
  let forcedExitTimer: NodeJS.Timeout | null = null;
  let requestedExitCode = 0;
  let indexerRuntimeStarted = false;
  let applicationBossInitialized = false;
  let cacheInvalidationDispatcher: CacheInvalidationDispatcher | null = null;
  try {
    // Indexer consumers can enqueue application jobs as soon as they begin
    // processing existing work. Establish the shared application pg-boss
    // instance in worker mode before those consumers can request producer mode.
    await getJobWorkerBoss();
    applicationBossInitialized = true;
    await startIndexerQueueRuntime();
    indexerRuntimeStarted = true;
    await startApplicationJobRuntime();
    cacheInvalidationDispatcher = await startCacheInvalidationDispatcher();
  } catch (error) {
    const cleanupResults = await Promise.allSettled([
      cacheInvalidationDispatcher?.close() ?? Promise.resolve(),
      applicationBossInitialized ? stopApplicationJobRuntime() : Promise.resolve(),
      indexerRuntimeStarted ? stopIndexerQueueRuntime() : Promise.resolve(),
      indexerPrisma.$disconnect(),
    ]);
    const cleanupErrors = cleanupResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Worker startup and cleanup failed",
      );
    }
    throw error;
  }
  console.info("[jobs] agentranking-worker started");
  async function shutdown(signal: string): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const shutdownStartedAt = Date.now();
      console.info("[jobs] shutdown", { signal, uptimeMs: shutdownStartedAt - startTime });
      const failures: unknown[] = [];
      const dispatcher = cacheInvalidationDispatcher;
      cacheInvalidationDispatcher = null;
      await runShutdownPhase({
        name: "cache invalidation dispatcher",
        operation: () => dispatcher
          ? settleWithin(
              dispatcher.close(),
              WORKER_SHUTDOWN_POLICY.cacheInvalidationCloseTimeoutMs,
              "cache invalidation dispatcher close",
            )
          : Promise.resolve(),
      }, failures);
      await Promise.all([
        runShutdownPhase({
          name: "application queue runtime",
          operation: () => stopApplicationJobRuntime({
            gracefulTimeoutMs: WORKER_SHUTDOWN_POLICY.pgBossGracefulTimeoutMs,
            forcedCloseTimeoutMs: WORKER_SHUTDOWN_POLICY.pgBossForcedCloseTimeoutMs,
          }),
        }, failures),
        runShutdownPhase({
          name: "indexer queue runtime",
          operation: () => stopIndexerQueueRuntime({
            gracefulTimeoutMs: WORKER_SHUTDOWN_POLICY.pgBossGracefulTimeoutMs,
            forcedCloseTimeoutMs: WORKER_SHUTDOWN_POLICY.pgBossForcedCloseTimeoutMs,
            resourceDrainTimeoutMs: WORKER_SHUTDOWN_POLICY.resourceDrainTimeoutMs,
          }),
        }, failures),
      ]);
      await runShutdownPhase({
        name: "Prisma disconnect",
        operation: () => settleWithin(
          indexerPrisma.$disconnect(),
          WORKER_SHUTDOWN_POLICY.prismaDisconnectTimeoutMs,
          "Prisma disconnect",
        ),
      }, failures);
      if (failures.length > 0) {
        throw new AggregateError(failures, "One or more worker shutdown steps failed");
      }
      console.info("[jobs] shutdown complete", {
        signal,
        durationMs: Date.now() - shutdownStartedAt,
      });
    })();
    return shutdownPromise;
  }
  function clearForcedExitTimer(): void {
    if (!forcedExitTimer) return;
    clearTimeout(forcedExitTimer);
    forcedExitTimer = null;
  }
  function requestShutdown(signal: string, exitCode = 0): void {
    requestedExitCode = Math.max(requestedExitCode, exitCode);
    if (!forcedExitTimer) {
      forcedExitTimer = setTimeout(() => {
        console.error("[jobs] forced shutdown deadline exceeded", {
          signal,
          timeoutMs: WORKER_SHUTDOWN_POLICY.forceExitTimeoutMs,
          requestedExitCode,
        });
        process.exit(requestedExitCode === 0 ? 1 : requestedExitCode);
      }, WORKER_SHUTDOWN_POLICY.forceExitTimeoutMs);
    }
    void shutdown(signal)
      .then(() => {
        clearForcedExitTimer();
        process.exit(requestedExitCode);
      })
      .catch((error) => {
        clearForcedExitTimer();
        console.error("[jobs] shutdown failed", error);
        process.exit(1);
      });
  }
  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  process.once("unhandledRejection", (reason) => {
    console.error("[jobs] unhandledRejection", reason);
    requestShutdown("unhandledRejection", 1);
  });
  process.once("uncaughtException", (error) => {
    console.error("[jobs] uncaughtException", error);
    requestShutdown("uncaughtException", 1);
  });
}
async function main(): Promise<void> {
  if (process.env.DEMO_MODE === "true") {
    console.info("[jobs] DEMO_MODE=true: indexers, schedules and queues are disabled; exiting");
    return;
  }
  const migrationIndex = process.argv.indexOf(PGBOSS_MIGRATION_FLAG);
  if (migrationIndex !== -1) {
    const releaseId = process.argv[migrationIndex + 1]?.trim();
    if (!releaseId) {
      throw new Error(`${PGBOSS_MIGRATION_FLAG} requires a release id`);
    }
    if (process.argv.length !== migrationIndex + 2) {
      throw new Error(`unexpected arguments after ${PGBOSS_MIGRATION_FLAG}`);
    }
    await migratePgBossForDeployment(releaseId);
    return;
  }
  await runWorker();
}
await main();
