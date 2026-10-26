/**
 * Recommended ranking: blend high protocol trust, AR Score, and power with review volume so the list
 * is not dominated by verified agents with empty review history.
 */
export type RecommendedAgentSignals = {
  readonly id: number | string;
  readonly discoveryScore?: number | null;
  readonly agentRankScore?: number | null;
  readonly totalFeedback?: number | null;
  readonly score?: number | null;
  readonly protocolTrustScore?: number | null;
  readonly powerScore?: number | null;
  readonly sapVerified?: boolean | null;
};
/** Log-scaled review engagement 0–100 (1 → ~20, 10 → ~30, 100 → ~40, 1000+ → ~60). */
export function reviewEngagementNorm(totalFeedback: number | null | undefined): number {
  const n = Math.max(0, totalFeedback ?? 0);
  if (n === 0) return 0;
  return Math.min(100, Math.log10(n + 1) * 20);
}
function protocolTrustValue(agent: RecommendedAgentSignals): number {
  return agent.protocolTrustScore ?? 0;
}
function discoveryValue(a: RecommendedAgentSignals): number {
  const d = a.discoveryScore ?? 0;
  if (d > 0) return d;
  return a.agentRankScore ?? 0;
}
/** Stable sort for Recommended lists (discoveryScore + review and protocol-trust tie-breaks). */
export function compareRecommendedAgents(a: RecommendedAgentSignals, b: RecommendedAgentSignals): number {
  const disc = discoveryValue(b) - discoveryValue(a);
  if (disc !== 0) return disc;
  const agentRankDifference = (b.agentRankScore ?? 0) - (a.agentRankScore ?? 0);
  if (agentRankDifference !== 0) return agentRankDifference;
  const fb = (b.totalFeedback ?? 0) - (a.totalFeedback ?? 0);
  if (fb !== 0) return fb;
  return protocolTrustValue(b) - protocolTrustValue(a);
}
/**
 * Build a Recommended page by interleaving leaders on blend score, reviews, and protocol trust
 * so Synapse-style high-trust/low-review rows do not crowd out Clawnch-style social proof.
 */
export function mixRecommendedAgents<T extends RecommendedAgentSignals>(
  pool: readonly T[],
  limit: number,
): T[] {
  if (pool.length === 0 || limit <= 0) return [];
  if (pool.length <= limit) return [...pool].sort(compareRecommendedAgents);
  const seen = new Set<string | number>();
  const out: T[] = [];
  const push = (row: T) => {
    if (seen.has(row.id) || out.length >= limit) return;
    seen.add(row.id);
    out.push(row);
  };
  const byBlend = [...pool].sort(compareRecommendedAgents);
  const byFeedback = [...pool].sort((x, y) => {
    const fb = (y.totalFeedback ?? 0) - (x.totalFeedback ?? 0);
    if (fb !== 0) return fb;
    return compareRecommendedAgents(x, y);
  });
  const byProtocolTrust = [...pool].sort((x, y) => {
    const protocolTrustDifference = protocolTrustValue(y) - protocolTrustValue(x);
    if (protocolTrustDifference !== 0) return protocolTrustDifference;
    return (y.totalFeedback ?? 0) - (x.totalFeedback ?? 0);
  });
  const bySap = [...pool]
    .filter((a) => a.sapVerified === true)
    .sort((x, y) => {
      const recommendationDifference = compareRecommendedAgents(x, y);
      if (recommendationDifference !== 0) return recommendationDifference;
      return (y.totalFeedback ?? 0) - (x.totalFeedback ?? 0);
    });
  let bi = 0;
  let fi = 0;
  let ai = 0;
  let si = 0;
  let guard = 0;
  while (out.length < limit && guard < limit * 8) {
    guard += 1;
    if (bi < byBlend.length) push(byBlend[bi++]);
    if (bi < byBlend.length && out.length < limit) push(byBlend[bi++]);
    if (fi < byFeedback.length && out.length < limit) push(byFeedback[fi++]);
    if (si < bySap.length && out.length < limit) push(bySap[si++]);
    if (ai < byProtocolTrust.length && out.length < limit) push(byProtocolTrust[ai++]);
  }
  for (const row of byBlend) {
    if (out.length >= limit) break;
    push(row);
  }
  return out;
}
