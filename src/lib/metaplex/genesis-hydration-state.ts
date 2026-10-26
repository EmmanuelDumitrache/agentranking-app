/** Client-safe genesis hydration predicates (no DB / Node imports). */
export function hasMetaplexGenesisLookupAttempted(metaplexRawData: unknown): boolean {
  if (!metaplexRawData || typeof metaplexRawData !== "object") return false;
  const genesis = (metaplexRawData as Record<string, unknown>).genesis;
  return genesis != null && typeof genesis === "object";
}
/** True when a bound token mint exists but genesis columns were never populated. */
export function needsMetaplexGenesisHydration(agent: {
  metaplexAgentTokenMint?: string | null;
  metaplexTradeUrl?: string | null;
  metaplexLaunchAddress?: string | null;
  metaplexRawData?: unknown;
}): boolean {
  const mint = agent.metaplexAgentTokenMint?.trim();
  if (!mint) return false;
  if (agent.metaplexTradeUrl?.trim() || agent.metaplexLaunchAddress?.trim()) return false;
  return !hasMetaplexGenesisLookupAttempted(agent.metaplexRawData);
}