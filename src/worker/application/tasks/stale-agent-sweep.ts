import { prisma } from "@/lib/db";
import { deactivateOverdueAgents } from "@/lib/compute-ranks-queries";
import { backgroundJobPausedResult } from "../task-utils";
import { checkBootstrapMaintenanceGate } from "../bootstrap-maintenance";

export async function staleAgentSweepJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const gate = await checkBootstrapMaintenanceGate();
  if (!gate.allowed) return { ok: true, skipped: true, reason: gate.reason, phase: gate.phase };
  const deactivated = await deactivateOverdueAgents(prisma);
  return { ok: true, deactivated };
}
