/**
 * Resolve AgentLaunch.agentDbId from stored string AgentLaunch.agentId.
 * Demo/local-test ids remain null.
 */
export function parseNumericAgentLaunchAgentDbId(
  agentId: string | null | undefined,
): number | null {
  const trimmed = agentId?.trim() ?? "";
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== trimmed || parsed <= 0) {
    return null;
  }
  return parsed;
}
export function resolveAgentLaunchDbIdFields(agentId: string | null | undefined): {
  agentId: string | null;
  agentDbId: number | null;
} {
  const trimmed = agentId?.trim() || null;
  return {
    agentId: trimmed,
    agentDbId: parseNumericAgentLaunchAgentDbId(trimmed),
  };
}
/** Prisma create payload: stored agentId plus optional linkedAgent connection. */
export function agentLaunchLinkageForCreate(agentId: string | null | undefined): {
  agentId: string | null;
  linkedAgent?: { connect: { id: number } };
} {
  const linkage = resolveAgentLaunchDbIdFields(agentId);
  if (!linkage.agentDbId) {
    return { agentId: linkage.agentId };
  }
  return {
    agentId: linkage.agentId,
    linkedAgent: { connect: { id: linkage.agentDbId } },
  };
}
/** Prisma update payload when agentId changes on a draft. */
export function agentLaunchLinkageForUpdate(agentId: string): {
  agentId: string | null;
  linkedAgent: { connect: { id: number } } | { disconnect: true };
} {
  const linkage = resolveAgentLaunchDbIdFields(agentId);
  return {
    agentId: linkage.agentId,
    linkedAgent: linkage.agentDbId
      ? { connect: { id: linkage.agentDbId } }
      : { disconnect: true },
  };
}
