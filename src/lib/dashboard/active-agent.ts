import type { DashboardAgentSummary } from "@/lib/dashboard/types";
import {
  defaultDashboardAgentPath,
  parseDashboardAgentDbIdFromPath,
} from "@/lib/dashboard/navigation";
export const LAST_AGENT_STORAGE_KEY = "ar-dashboard-last-agent-id";
export const LAST_AGENT_STORAGE_EVENT = "ar-dashboard-last-agent-change";
export function readStoredAgentId(ownedAgents: readonly DashboardAgentSummary[]): number | null {
  if (typeof globalThis.window === "undefined") return null;
  try {
    const raw = globalThis.localStorage.getItem(LAST_AGENT_STORAGE_KEY);
    if (!raw) return null;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return ownedAgents.some((agent) => agent.id === id) ? id : null;
  } catch {
    return null;
  }
}
export function writeStoredAgentId(agentDbId: number): void {
  try {
    globalThis.localStorage.setItem(LAST_AGENT_STORAGE_KEY, String(agentDbId));
    globalThis.window.dispatchEvent(new Event(LAST_AGENT_STORAGE_EVENT));
  } catch {
    // ignore quota / private mode
  }
}
/**
 * Resolve which agent the sidebar should treat as active.
 * - URL agent wins on agent-scoped pages
 * - Last selected (localStorage) wins on account pages like Settings
 * - SSR prop is last resort (layout soft-nav can leave it stale)
 */
export function resolveActiveAgentDbId(input: {
  readonly pathAgentId: number | null;
  readonly storedAgentId: number | null;
  readonly selectedAgentDbId: number | null;
}): number | null {
  return input.pathAgentId ?? input.storedAgentId ?? input.selectedAgentDbId;
}
/** Switch agents but stay on the same workspace section when possible. */
export function agentSwitchHref(pathname: string, targetAgentId: number): string {
  const current = parseDashboardAgentDbIdFromPath(pathname);
  if (current != null && pathname.includes(`/agents/${current}`)) {
    return pathname.replace(`/agents/${current}`, `/agents/${targetAgentId}`);
  }
  return defaultDashboardAgentPath(targetAgentId);
}
