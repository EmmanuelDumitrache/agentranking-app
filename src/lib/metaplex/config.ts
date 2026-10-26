export const METAPLEX_LISTING_REGISTRY_SOURCE = "metaplex";
export const METAPLEX_SOURCE_TYPE = "agent-registry";
export const METAPLEX_HUB_INTRO =
  "MPL Core agents with AgentIdentity, indexed from the Metaplex registry on Solana.";
/** Registry presence on Metaplex — not AR/KYA verification. */
export const METAPLEX_REGISTRY_DETECTED_LABEL = "Registry detected";
export const METAPLEX_AGENT_IDENTITY_PLUGIN_LABEL = "AgentIdentity plugin";
export const METAPLEX_TOKEN_LINKED_LABEL = "Token linked";
export const METAPLEX_GENESIS_SOURCE_LABEL = "Metaplex Genesis";
export const METAPLEX_TRADE_ON_METAPLEX_LABEL = "Trade on Metaplex";
export const METAPLEX_INDEXED_BADGE_LABEL = "Metaplex";
export const METAPLEX_EMPTY_INDEX_MESSAGE =
  "No Metaplex agents indexed yet. Paste a Metaplex Core asset address from the admin panel to index the first registered agent.";
export const METAPLEX_INDEXED_SHORT_DISCLAIMER =
  "Indexed on-chain — not KYA or AgentRanking verification.";

/** Server-side product gate. Disabled unless explicitly enabled. */
export function metaplexProductEnabled(): boolean {
  const value = process.env.METAPLEX_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
