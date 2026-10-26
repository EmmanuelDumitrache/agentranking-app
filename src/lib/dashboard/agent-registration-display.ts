import { isAgentSolanaDirectoryListed } from "@/lib/agent-solana-registration/display";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";

export function isDashboardAgentSolanaRegistered(
  agent: Pick<DashboardAgentSummary, "isSolanaRegistered">,
): boolean {
  return agent.isSolanaRegistered;
}

export function resolveDashboardAgentSolanaRegistered(agent: {
  solanaAssetAddress?: string | null;
  solanaCanonicalStatus?: string | null;
}): boolean {
  return isAgentSolanaDirectoryListed(agent);
}
