export const AGENT_DIRECTORY_VISIBLE_POLL_MS = 90_000;
export const AGENT_DIRECTORY_HIDDEN_POLL_MS = 10 * 60_000;
export const AGENT_DIRECTORY_COLD_START_POLL_MS = 5_000;
export const AGENT_DIRECTORY_COLD_START_WINDOW_MS = 10 * 60_000;

export type AgentDirectoryPollingInput = {
  status: "pending" | "error" | "success";
  visible: boolean;
  firstPage: boolean;
  hasFilters: boolean;
  agentCount: number | null;
  elapsedSinceMountMs: number;
};

/**
 * Poll the unfiltered first page aggressively only while it is still empty and
 * the page is inside its bounded cold-start observation window. A genuinely
 * empty installation therefore cannot create permanent five-second polling.
 */
export function agentDirectoryRefetchInterval(
  input: AgentDirectoryPollingInput,
): number | false {
  if (input.status === "error") return false;
  if (!input.visible) return AGENT_DIRECTORY_HIDDEN_POLL_MS;
  const coldStartEmpty =
    input.status === "success" &&
    input.firstPage &&
    !input.hasFilters &&
    input.agentCount === 0 &&
    input.elapsedSinceMountMs < AGENT_DIRECTORY_COLD_START_WINDOW_MS;
  return coldStartEmpty
    ? AGENT_DIRECTORY_COLD_START_POLL_MS
    : AGENT_DIRECTORY_VISIBLE_POLL_MS;
}
