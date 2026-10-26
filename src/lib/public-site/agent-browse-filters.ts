export type PublicAgentSortKey = "agent_rank" | "new" | "active" | "verified" | "tokenized";
const PUBLIC_AGENT_SORT_KEYS = new Set<PublicAgentSortKey>([
  "agent_rank",
  "new",
  "active",
  "verified",
  "tokenized",
]);
export function isPublicAgentSortKey(value: string | null | undefined): value is PublicAgentSortKey {
  return typeof value === "string" && PUBLIC_AGENT_SORT_KEYS.has(value as PublicAgentSortKey);
}
export type AgentBrowseSortable = {
  readonly agentRankScore: number | null;
  readonly listedAt: string | null;
  readonly lastActiveAt: string | null;
  readonly isVerified: boolean;
  readonly isTokenized: boolean;
};
export type AgentSearchFields = {
  readonly name: string;
  readonly description: string;
  readonly linkedToken?: {
    readonly tokenSymbol: string | null;
    readonly tokenName: string | null;
    readonly mint: string;
  } | null;
};
function agentRankValue(agentRankScore: number | null): number {
  return agentRankScore ?? Number.NEGATIVE_INFINITY;
}
function timeValue(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : 0;
}
/** Higher wins. Returns 0 when the query does not match. */
export function computeAgentSearchRelevance(
  agent: AgentSearchFields,
  rawQuery: string,
): number {
  const raw = rawQuery.trim();
  if (!raw.length) return 0;
  const qLower = raw.toLowerCase();
  const qTicker = qLower.replace(/^\$/, "");
  const name = agent.name.trim().toLowerCase();
  const desc = agent.description.trim().toLowerCase();
  const symbol = agent.linkedToken?.tokenSymbol?.trim().toLowerCase() ?? "";
  const tokenName = agent.linkedToken?.tokenName?.trim().toLowerCase() ?? "";
  const mint = agent.linkedToken?.mint?.trim() ?? "";
  const candidates = [
    { matches: Boolean(mint) && mint === raw, score: 950_000 },
    { matches: name === qLower, score: 920_000 },
    {
      matches: Boolean(symbol) && (symbol === qTicker || `$${symbol}` === qLower),
      score: 910_000,
    },
    {
      matches: name.startsWith(qLower),
      score: 880_000 - Math.min(name.length, 499),
    },
    {
      matches: symbol.startsWith(qTicker),
      score: 860_000 - Math.min(symbol.length, 499),
    },
    {
      matches: name.includes(qLower),
      score: 760_000 - Math.min(name.indexOf(qLower), 599),
    },
    { matches: tokenName.includes(qLower), score: 680_000 },
    { matches: symbol.includes(qTicker), score: 660_000 },
    { matches: desc.includes(qLower), score: 560_000 },
    { matches: raw.length >= 12 && mint.includes(raw), score: 530_000 },
  ];
  return candidates.reduce(
    (best, candidate) => candidate.matches ? Math.max(best, candidate.score) : best,
    0,
  );
}
export function compareByAgentSort(
  a: AgentBrowseSortable,
  b: AgentBrowseSortable,
  sort: PublicAgentSortKey,
): number {
  switch (sort) {
    case "agent_rank":
      return agentRankValue(b.agentRankScore) - agentRankValue(a.agentRankScore);
    case "new":
      return timeValue(b.listedAt) - timeValue(a.listedAt);
    case "active":
      return timeValue(b.lastActiveAt) - timeValue(a.lastActiveAt);
    case "verified": {
      const aVerified = a.isVerified ? 1 : 0;
      const bVerified = b.isVerified ? 1 : 0;
      if (aVerified !== bVerified) return bVerified - aVerified;
      return agentRankValue(b.agentRankScore) - agentRankValue(a.agentRankScore);
    }
    case "tokenized": {
      const aTokenized = a.isTokenized ? 1 : 0;
      const bTokenized = b.isTokenized ? 1 : 0;
      if (aTokenized !== bTokenized) return bTokenized - aTokenized;
      return agentRankValue(b.agentRankScore) - agentRankValue(a.agentRankScore);
    }
    default: {
      const _exhaustive: never = sort;
      return _exhaustive;
    }
  }
}
