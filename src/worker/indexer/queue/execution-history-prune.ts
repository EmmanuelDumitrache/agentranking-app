import { prisma } from "../db.js";

const EXECUTION_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000;
// The scheduler runs every five minutes. Small, bounded quanta keep retention
// from competing with a deep live queue while still allowing more than one
// million historical rows per table to be retired each day.
const EXECUTION_HISTORY_PRUNE_BATCH = 2_000;
const EXECUTION_HISTORY_MAX_BATCHES = 2;

export type ExecutionHistoryPruneResult = {
  idempotencyRecords: number;
  completedLeases: number;
  terminalLeases: number;
  dispatchedOutbox: number;
  rangeLeases: number;
  bootstrapWorkItems: number;
  bootstrapEpochs: number;
};

/**
 * Bound the durable replay ledger after pg-boss has already removed successful
 * fan-out jobs. Source materializers remain independently idempotent, so a very
 * old coordinate can still be replayed safely after this retention horizon.
 */
async function pruneIndexerExecutionHistoryBatch(
  now = new Date(),
): Promise<ExecutionHistoryPruneResult> {
  const cutoff = new Date(now.getTime() - EXECUTION_HISTORY_RETENTION_MS);
  const [result] = await prisma.$queryRaw<Array<ExecutionHistoryPruneResult>>`
    WITH completed_candidates AS MATERIALIZED (
      SELECT business_key
      FROM indexer_idempotency_records
      WHERE completed_at < ${cutoff}
      ORDER BY completed_at ASC, business_key ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${EXECUTION_HISTORY_PRUNE_BATCH}
    ), terminal_candidates AS MATERIALIZED (
      SELECT business_key
      FROM indexer_job_leases
      WHERE state IN ('failed', 'expired', 'cancelled')
        AND last_meaningful_progress_at < ${cutoff}
        AND NOT EXISTS (
          SELECT 1
          FROM indexer_idempotency_records AS completed
          WHERE completed.business_key = indexer_job_leases.business_key
        )
      ORDER BY state ASC, last_meaningful_progress_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${EXECUTION_HISTORY_PRUNE_BATCH}
    ), outbox_candidates AS MATERIALIZED (
      SELECT id
      FROM indexer_outbox
      WHERE dispatched_at < ${cutoff}
      ORDER BY dispatched_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${EXECUTION_HISTORY_PRUNE_BATCH}
    ), protected_bootstrap_epochs AS MATERIALIZED (
      SELECT id
      FROM indexer_bootstrap_epochs
      ORDER BY started_at DESC, id DESC
      LIMIT 2
    ), completed_range_candidates AS MATERIALIZED (
      SELECT lease.id
      FROM indexer_range_leases AS lease
      JOIN indexer_source_cursors AS cursor
        ON cursor.source_key = lease.source_key
      WHERE lease.status = 'COMPLETE'
        AND lease.completed_at < ${cutoff}
        AND cursor.block_number IS NOT NULL
        AND lease.to_block <= cursor.block_number
      ORDER BY lease.completed_at ASC, lease.id ASC
      FOR UPDATE OF lease SKIP LOCKED
      LIMIT ${Math.floor(EXECUTION_HISTORY_PRUNE_BATCH / 2)}
    ), invalidated_range_candidates AS MATERIALIZED (
      SELECT lease.id
      FROM indexer_range_leases AS lease
      JOIN indexer_source_cursors AS cursor
        ON cursor.source_key = lease.source_key
      WHERE lease.status = 'INVALIDATED'
        AND lease.updated_at < ${cutoff}
        AND cursor.block_number IS NOT NULL
        AND lease.to_block <= cursor.block_number
      ORDER BY lease.updated_at ASC, lease.id ASC
      FOR UPDATE OF lease SKIP LOCKED
      LIMIT ${Math.ceil(EXECUTION_HISTORY_PRUNE_BATCH / 2)}
    ), bootstrap_work_candidates AS MATERIALIZED (
      SELECT work.epoch_id, work.work_key
      FROM indexer_bootstrap_work_items AS work
      JOIN indexer_bootstrap_epochs AS epoch ON epoch.id = work.epoch_id
      WHERE epoch.completed_at < ${cutoff}
        AND epoch.status IN ('COMPLETE', 'DEGRADED', 'FAILED')
        AND NOT EXISTS (
          SELECT 1
          FROM protected_bootstrap_epochs AS protected
          WHERE protected.id = epoch.id
        )
      ORDER BY epoch.completed_at ASC, work.epoch_id ASC, work.work_key ASC
      FOR UPDATE OF work SKIP LOCKED
      LIMIT ${EXECUTION_HISTORY_PRUNE_BATCH}
    ), deleted_completed_leases AS (
      DELETE FROM indexer_job_leases AS lease
      USING completed_candidates AS candidate
      WHERE lease.business_key = candidate.business_key
      RETURNING 1
    ), deleted_terminal_leases AS (
      DELETE FROM indexer_job_leases AS lease
      USING terminal_candidates AS candidate
      WHERE lease.business_key = candidate.business_key
      RETURNING 1
    ), deleted_records AS (
      DELETE FROM indexer_idempotency_records AS record
      USING completed_candidates AS candidate
      WHERE record.business_key = candidate.business_key
      RETURNING 1
    ), deleted_outbox AS (
      DELETE FROM indexer_outbox AS outbox
      USING outbox_candidates AS candidate
      WHERE outbox.id = candidate.id
      RETURNING 1
    ), deleted_ranges AS (
      DELETE FROM indexer_range_leases AS lease
      WHERE lease.id IN (
        SELECT id FROM completed_range_candidates
        UNION ALL
        SELECT id FROM invalidated_range_candidates
      )
      RETURNING 1
    ), deleted_bootstrap_work AS (
      DELETE FROM indexer_bootstrap_work_items AS work
      USING bootstrap_work_candidates AS candidate
      WHERE work.epoch_id = candidate.epoch_id
        AND work.work_key = candidate.work_key
      RETURNING 1
    ), deleted_bootstrap_epochs AS (
      DELETE FROM indexer_bootstrap_epochs AS epoch
      WHERE epoch.completed_at < ${cutoff}
        AND epoch.status IN ('COMPLETE', 'DEGRADED', 'FAILED')
        AND NOT EXISTS (
          SELECT 1
          FROM protected_bootstrap_epochs AS protected
          WHERE protected.id = epoch.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM indexer_bootstrap_work_items AS work
          WHERE work.epoch_id = epoch.id
        )
      RETURNING 1
    )
    SELECT
      (SELECT COUNT(*)::integer FROM deleted_records) AS "idempotencyRecords",
      (SELECT COUNT(*)::integer FROM deleted_completed_leases) AS "completedLeases",
      (SELECT COUNT(*)::integer FROM deleted_terminal_leases) AS "terminalLeases",
      (SELECT COUNT(*)::integer FROM deleted_outbox) AS "dispatchedOutbox",
      (SELECT COUNT(*)::integer FROM deleted_ranges) AS "rangeLeases",
      (SELECT COUNT(*)::integer FROM deleted_bootstrap_work) AS "bootstrapWorkItems",
      (SELECT COUNT(*)::integer FROM deleted_bootstrap_epochs) AS "bootstrapEpochs"
  `;
  return result ?? {
    idempotencyRecords: 0,
    completedLeases: 0,
    terminalLeases: 0,
    dispatchedOutbox: 0,
    rangeLeases: 0,
    bootstrapWorkItems: 0,
    bootstrapEpochs: 0,
  };
}

export async function pruneIndexerExecutionHistory(
  now = new Date(),
): Promise<ExecutionHistoryPruneResult> {
  const total: ExecutionHistoryPruneResult = {
    idempotencyRecords: 0,
    completedLeases: 0,
    terminalLeases: 0,
    dispatchedOutbox: 0,
    rangeLeases: 0,
    bootstrapWorkItems: 0,
    bootstrapEpochs: 0,
  };
  for (let batch = 0; batch < EXECUTION_HISTORY_MAX_BATCHES; batch += 1) {
    const result = await pruneIndexerExecutionHistoryBatch(now);
    total.idempotencyRecords += result.idempotencyRecords;
    total.completedLeases += result.completedLeases;
    total.terminalLeases += result.terminalLeases;
    total.dispatchedOutbox += result.dispatchedOutbox;
    total.rangeLeases += result.rangeLeases;
    total.bootstrapWorkItems += result.bootstrapWorkItems;
    total.bootstrapEpochs += result.bootstrapEpochs;
    const mayHaveMore =
      result.idempotencyRecords >= EXECUTION_HISTORY_PRUNE_BATCH ||
      result.terminalLeases >= EXECUTION_HISTORY_PRUNE_BATCH ||
      result.dispatchedOutbox >= EXECUTION_HISTORY_PRUNE_BATCH ||
      result.rangeLeases >= Math.floor(EXECUTION_HISTORY_PRUNE_BATCH / 2) ||
      result.bootstrapWorkItems > 0;
    if (!mayHaveMore) break;
  }
  return total;
}
