import { prisma } from "@/lib/db";

export type BootstrapMaintenanceContext = {
  epochId: string;
  topologyHash: string;
};

export type BootstrapMaintenanceGate =
  | { allowed: true; phase: "DERIVED" | "STEADY" }
  | { allowed: false; phase: string; reason: string };

/**
 * Periodic rank/cache maintenance must not publish partially bootstrapped state.
 * The derived finalizer may explicitly enter through the active epoch context.
 */
export async function checkBootstrapMaintenanceGate(
  context?: BootstrapMaintenanceContext,
): Promise<BootstrapMaintenanceGate> {
  const active = await prisma.indexerBootstrapEpoch.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    select: { id: true, phase: true, topologyHash: true },
  });
  if (!active) return { allowed: true, phase: "STEADY" };
  if (
    context &&
    active.phase === "DERIVED" &&
    active.id === context.epochId &&
    active.topologyHash === context.topologyHash
  ) {
    return { allowed: true, phase: "DERIVED" };
  }
  return {
    allowed: false,
    phase: active.phase,
    reason: `indexer_bootstrap_${active.phase.toLowerCase()}_active`,
  };
}
