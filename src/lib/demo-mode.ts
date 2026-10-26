/**
 * Recruiter demo deployment: serves the committed public snapshot
 * (`demo/snapshot`), runs no background work, and refuses every write that
 * would touch accounts, payments, or chains.
 *
 * Servers read `DEMO_MODE`; next.config mirrors it into
 * `NEXT_PUBLIC_DEMO_MODE` so client components see the same flag.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true" || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

/** Fixed identity for the one-click demo sign-in. */
export const DEMO_ACCOUNT_EMAIL = "demo@agentranking.demo";
export const DEMO_ACCOUNT_NAME = "Demo User";

/** Response header the browser runtime uses to recognise a demo refusal. */
export const DEMO_BLOCKED_HEADER = "x-agentranking-demo";

/** Window event that opens the demo notice. */
export const DEMO_BLOCKED_EVENT = "agentranking:demo-blocked";

export const DEMO_BLOCKED_MESSAGE =
  "This is the AgentRanking demo. Launches, staking, payments, wallet signing and other writes are disabled.";
