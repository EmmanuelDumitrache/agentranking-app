import type { AgentDeactivationDuePayload } from "@/jobs/contracts";
import { prisma } from "@/lib/db";
import { backgroundJobPausedResult } from "../task-utils";
import { checkBootstrapMaintenanceGate } from "../bootstrap-maintenance";

export async function deactivateAgentDueJob(payload: AgentDeactivationDuePayload) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const gate = await checkBootstrapMaintenanceGate();
  if (!gate.allowed) return { ok: true, skipped: true, reason: gate.reason, phase: gate.phase };
  const expectedLastActiveAt = new Date(payload.lastActiveAt);
  const staleBefore = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);
  const result = await prisma.agent.updateMany({
    where: {
      id: payload.agentId,
      lastActiveAt: { equals: expectedLastActiveAt, lte: staleBefore },
      isActive: true,
      isPremiumVerified: false,
      isVerified: false,
    },
    data: { isActive: false },
  });
  return { ok: true, deactivated: result.count === 1 };
}
