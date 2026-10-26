import "server-only";

import { loadAgentSolanaRegistrationPageData } from "@/lib/agent-solana-registration/service";

export type { AgentSolanaRegistrationPageData } from "@/lib/agent-solana-registration/types";

export async function loadDashboardRegisterPageData(agentDbId: number) {
  return loadAgentSolanaRegistrationPageData(agentDbId);
}
