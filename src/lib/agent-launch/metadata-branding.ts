const AGENTRANKING_ATTRIBUTION = "Powered by AgentRanking.io";
const AGENTRANKING_LAUNCHED_ATTRIBUTION = "Launched on AgentRanking.io";
const AGENTRANKING_FALLBACK_BASE = "https://agentranking.io";
export function buildAgentRankingTokenExternalUrl(params: {
  mint: string | null;
  baseUrl?: string;
}): string {
  const base = params.baseUrl?.trim() || AGENTRANKING_FALLBACK_BASE;
  const normalized = base.replace(/\/$/, "");
  if (params.mint?.trim()) {
    return `${normalized}/tokens/${params.mint.trim()}`;
  }
  return `${normalized}/agents`;
}
export function buildAgentRankingTokenDescription(params: {
  userDescription: string;
}): string {
  const user = params.userDescription.trim();
  if (user) {
    return `${user}\n\n${AGENTRANKING_ATTRIBUTION}`;
  }
  return `Agent launch indexed through ${AGENTRANKING_ATTRIBUTION}`;
}
/** Robinhood Chain on-chain description suffix (mirrors Solana attribution pattern). */
export function buildRobinhoodLaunchDescription(params: {
  userDescription: string;
}): string {
  const user = params.userDescription.trim();
  const attribution = AGENTRANKING_LAUNCHED_ATTRIBUTION;
  if (user) {
    if (user.includes(attribution)) return user;
    return `${user}\n\n${attribution}`;
  }
  return attribution;
}
export { AGENTRANKING_LAUNCHED_ATTRIBUTION };
