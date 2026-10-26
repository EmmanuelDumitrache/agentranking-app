/**
 * Tag shared by `unstable_cache` entries for agent public payloads and routes that
 * should bust them (`revalidateTag`, same string as POST-order flows).
 */
export function agentPublicAgentCacheTag(chainId: number, onChainAgentId: number): string {
  return `agent-${chainId}-${onChainAgentId}`;
}