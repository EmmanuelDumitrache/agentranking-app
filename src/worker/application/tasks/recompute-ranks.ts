import { prisma } from "@/lib/db";
import { runRankProjectionQueries } from "@/lib/compute-ranks-queries";
import { withDatabaseConcurrencyRetry } from "@/worker/indexer/lib/serializable-retry";
import { backgroundJobPausedResult } from "../task-utils";
import { checkBootstrapMaintenanceGate, type BootstrapMaintenanceContext } from "../bootstrap-maintenance";

export async function recomputeRanksJob(context?: BootstrapMaintenanceContext) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const gate = await checkBootstrapMaintenanceGate(context);
  if (!gate.allowed) return { ok: true, skipped: true, reason: gate.reason, phase: gate.phase };
  // Projection SQL claims mutable rows in deterministic order with SKIP LOCKED,
  // avoiding the broad row-lock cycles that previously produced 40P01. Keep the
  // standard bounded retry as a final guard for unrelated transient DB conflicts.
  await withDatabaseConcurrencyRetry(() => runRankProjectionQueries(prisma));
  return { ok: true };
}
