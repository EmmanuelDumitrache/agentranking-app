import type { DashboardAgentSummary } from "@/lib/dashboard/types";
/** Newest owned agent (highest db id) — used when no agent is in the URL yet. */
export function pickNewestOwnedAgentId(
  agents: readonly Pick<DashboardAgentSummary, "id">[],
): number | null {
  if (agents.length === 0) return null;
  return agents.reduce((a, b) => (a.id > b.id ? a : b)).id;
}
