import { config } from "../config.js";
import { logger } from "../logger.js";
import { drainRpcQueues, startRpcHealthMonitor, stopRpcHealthMonitor } from "../sync/rpc.js";
import { startSolanaRpcHealthMonitor, stopSolanaRpcHealthMonitor } from "../sync/solana-rpc-evidence.js";
import { drainPublicMetadataClients } from "../lib/public-json.js";
import { settleWithin } from "../../settle-within.js";
import { getBoss, stopBoss, type StopIndexerBossOptions } from "./boss.js";
import {
  startIndexerScheduleCoordinator,
  stopIndexerScheduleCoordinator,
} from "./scheduler-leader.js";
import { registerIndexerWorkers } from "./register-workers.js";
import { assertCanonicalChainDescriptors } from "../chains.js";
import { getRpcUrls, getSyncableChainIds } from "../sync/rpc.js";
let started = false;
const DEFAULT_RESOURCE_DRAIN_TIMEOUT_MS = 5_000;
export type StopIndexerQueueRuntimeOptions = StopIndexerBossOptions & {
  readonly resourceDrainTimeoutMs?: number;
};
function logCleanupFailures(results: readonly PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error(
        "indexer runtime startup cleanup failed",
        {
          error: Error.isError(result.reason)
            ? result.reason.message
            : String(result.reason),
        },
        "queue",
      );
    }
  }
}
function collectCleanupFailures(
  results: readonly PromiseSettledResult<unknown>[],
  failures: unknown[],
): void {
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }
}
function resourceDrainTimeout(value: number | undefined): number {
  if (value == null) return DEFAULT_RESOURCE_DRAIN_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("resourceDrainTimeoutMs must be a positive safe integer");
  }
  return value;
}
async function cleanupFailedStartup(): Promise<void> {
  logCleanupFailures(
    await Promise.allSettled([
      stopIndexerScheduleCoordinator(),
      stopBoss(),
    ]),
  );
  logCleanupFailures(
    await Promise.allSettled([
      stopRpcHealthMonitor(),
      stopSolanaRpcHealthMonitor(),
      drainRpcQueues(),
      drainPublicMetadataClients(),
    ]),
  );
}
export async function startIndexerQueueRuntime(): Promise<void> {
  if (started) return;
  assertCanonicalChainDescriptors();
  for (const chainId of getSyncableChainIds()) {
    if (getRpcUrls(chainId).length === 0) {
      throw new Error(`enabled EVM chain ${chainId} has no eligible RPC endpoint`);
    }
  }
  try {
    const boss = await getBoss();
    await registerIndexerWorkers(boss);
    await startIndexerScheduleCoordinator(boss);
    startRpcHealthMonitor();
    startSolanaRpcHealthMonitor();
    started = true;
    logger.info(
      "pg-boss indexer runtime started",
      {
        catchupCron: config.catchupCron,
        validationSyncCron: config.validationSyncCron,
        feedbackSyncCron: config.feedbackSyncCron,
        solana8004SnapshotCron: config.solana8004SnapshotCron,
      },
      "queue",
    );
  } catch (error) {
    await cleanupFailedStartup();
    throw error;
  }
}
export async function stopIndexerQueueRuntime(
  options: StopIndexerQueueRuntimeOptions = {},
): Promise<void> {
  const drainTimeoutMs = resourceDrainTimeout(options.resourceDrainTimeoutMs);
  if (!started) return;
  started = false;
  const failures: unknown[] = [];
  collectCleanupFailures(
    await Promise.allSettled([
      stopIndexerScheduleCoordinator(),
      stopRpcHealthMonitor(),
      stopSolanaRpcHealthMonitor(),
    ]),
    failures,
  );
  await stopBoss(options).catch((error) => failures.push(error));
  await settleWithin(
    Promise.allSettled([
      drainRpcQueues(),
      drainPublicMetadataClients(),
    ]).then((results) => collectCleanupFailures(results, failures)),
    drainTimeoutMs,
    "indexer resource drain",
  ).catch((error) => failures.push(error));
  if (failures.length > 0) {
    throw new AggregateError(failures, "indexer queue runtime shutdown failed");
  }
}
