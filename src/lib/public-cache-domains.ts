/** Shared generation for Agent-backed public lists and statistics. */
export const AGENT_PUBLIC_CONTENT_CACHE_DOMAIN = "agent:public-content";

export function agentPayloadCacheDomain(chainId: number, agentId: number): string {
  return `agent:payload:${chainId}:${agentId}`;
}
