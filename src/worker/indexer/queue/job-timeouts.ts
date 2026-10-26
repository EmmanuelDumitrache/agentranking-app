import { INDEXER_QUEUES } from "./queues.js";

export const INDEXER_JOB_TIMEOUT_MS: Readonly<Record<string, number>> = {
  [INDEXER_QUEUES.BOOTSTRAP_ADVANCE]: 5 * 60_000,
  [INDEXER_QUEUES.DERIVED_FINALIZE]: 2 * 60 * 60_000,
  [INDEXER_QUEUES.AGENT_SYNC]: 8 * 60_000,
  [INDEXER_QUEUES.AGENT_METADATA]: 8 * 60_000,
  [INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN]: 8 * 60_000,
  [INDEXER_QUEUES.CLUSTER_RECONCILE]: 10 * 60_000,
  [INDEXER_QUEUES.CATCHUP_SCAN]: 8 * 60_000,
  [INDEXER_QUEUES.VALIDATION_SCAN]: 8 * 60_000,
  [INDEXER_QUEUES.FEEDBACK_SCAN]: 8 * 60_000,
  [INDEXER_QUEUES.CHAIN_CATCHUP]: 12 * 60_000,
  [INDEXER_QUEUES.CHAIN_CATCHUP_RANGE]: 30 * 60_000,
  [INDEXER_QUEUES.FEEDBACK_SYNC]: 12 * 60_000,
  [INDEXER_QUEUES.VALIDATION_SYNC]: 12 * 60_000,
  [INDEXER_QUEUES.SOLANA_8004_SNAPSHOT]: 15 * 60_000,
  [INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN]: 15 * 60_000,
  [INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC]: 20 * 60_000,
  [INDEXER_QUEUES.METAPLEX_SNAPSHOT]: 30 * 60_000,
  [INDEXER_QUEUES.SOLANA_METADATA]: 8 * 60_000,
  [INDEXER_QUEUES.SCORE_RECALCULATE]: 8 * 60_000,
  [INDEXER_QUEUES.SCORE_REPAIR_SCAN]: 8 * 60_000,
};

/**
 * pg-boss expiry starts when a row is claimed, before it necessarily obtains
 * the process-wide execution slot. Keep expiry outside the durable operation
 * deadline so the durable timeout can abort, checkpoint, and settle the job
 * instead of pg-boss killing the handler first.
 */
export function indexerQueueExpireInSeconds(
  queue: string,
  configuredMinimumSeconds: number,
): number {
  const operationTimeoutMs = INDEXER_JOB_TIMEOUT_MS[queue];
  if (operationTimeoutMs == null) return configuredMinimumSeconds;
  const headroomMs = Math.max(5 * 60_000, Math.ceil(operationTimeoutMs / 2));
  const settlementGraceMs = 60_000;
  const withHeadroomSeconds = Math.ceil(
    (operationTimeoutMs + headroomMs + settlementGraceMs) / 60_000,
  ) * 60;
  return Math.max(configuredMinimumSeconds, withHeadroomSeconds);
}
