import { prisma } from "@/lib/db";
import { snapshotRankHistory } from "@/lib/compute-ranks-queries";
import { backgroundJobPausedResult } from "../task-utils";
import { checkBootstrapMaintenanceGate } from "../bootstrap-maintenance";

export async function rankSnapshotJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const gate = await checkBootstrapMaintenanceGate();
  if (!gate.allowed) return { ok: true, skipped: true, reason: gate.reason, phase: gate.phase };
  const snapshots = await snapshotRankHistory(prisma);
  return { ok: true, snapshots };
}
