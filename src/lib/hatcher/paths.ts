import { HATCHER_CHAIN_ID } from "@/lib/hatcher/config";
import { agentPublicPath } from "@/lib/agent-public-url";

/** Public profile URL for a Hatcher-indexed AgentRanking record. */
export function hatcherProfilePath(agentId: number, name: string): string {
  return agentPublicPath({ chainId: HATCHER_CHAIN_ID, agentId, name });
}
