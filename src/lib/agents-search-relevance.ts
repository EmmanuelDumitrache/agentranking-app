/** Text match ranking for `/api/agents` when `search` is set — prefer exact name hits over score-only ranking. */
export const SEARCH_RELEVANCE_POOL_MAX = 160;
/** Higher wins. Secondary sort uses listing `score` in route handler. */
export function computeAgentSearchRelevanceAgent(
  agent: {
    name: string;
    description?: string | null;
    owner?: string | null;
    sapAgentPda?: string | null;
    sapOwnerWallet?: string | null;
  },
  rawQuery: string,
): number {
  const raw = rawQuery.trim();
  if (!raw.length) return 0;
  const qLower = raw.toLowerCase();
  const name = agent.name.trim().toLowerCase();
  const desc = (agent.description ?? "").toLowerCase();
  const owner = (agent.owner ?? "").toLowerCase();
  const pda = agent.sapAgentPda?.trim() ?? "";
  const sapWallet = agent.sapOwnerWallet?.trim() ?? "";
  if (pda === raw || sapWallet === raw) return 950_000;
  if (name === qLower) return 920_000;
  if (name.startsWith(qLower)) return 880_000 - Math.min(name.length, 499);
  if (name.includes(qLower)) return 760_000 - Math.min(name.length, 599);
  if (desc.includes(qLower)) return 560_000;
  if (owner.includes(qLower) || owner === qLower) return 540_000;
  /** Partial PDA/wallet paste (avoid short accidental matches). */
  if (raw.length >= 12) {
    if (pda?.includes(raw)) return 530_000;
    if (sapWallet?.includes(raw)) return 530_000;
  }
  return 100;
}