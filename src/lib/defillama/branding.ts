/** Canonical DefiLlama listing identity. Production URLs only — never localhost. */
export const DEFILLAMA_PROTOCOL_SLUG = "agentranking";
export const DEFILLAMA_PROTOCOL_NAME = "AgentRanking";
export const DEFILLAMA_WEBSITE = "https://agentranking.io";
export const DEFILLAMA_TWITTER = "https://x.com/agentranking";
export const DEFILLAMA_DOCS = "https://agentranking.io/docs";
export const DEFILLAMA_LAUNCH_URL = "https://agentranking.io/launch/new";
export const DEFILLAMA_TOKENS_URL = "https://agentranking.io/tokens";
export const DEFILLAMA_ROBINHOOD_TOKENS_URL = "https://agentranking.io/tokens/robinhood";
/** Square 512×512 landing mark (transparent) — Llama rounds corners. */
export const DEFILLAMA_LOGO_URL = "https://agentranking.io/ar-mark-square.png";
export const DEFILLAMA_CATEGORY = "Launchpad";
export const DEFILLAMA_FEES_EXPORT_URL = "https://agentranking.io/api/public/defillama/fees";
export const DEFILLAMA_LAUNCHES_EXPORT_URL = "https://agentranking.io/api/public/defillama/launches";

export function defillamaBranding() {
  return {
    protocol: DEFILLAMA_PROTOCOL_SLUG,
    name: DEFILLAMA_PROTOCOL_NAME,
    website: DEFILLAMA_WEBSITE,
    twitter: DEFILLAMA_TWITTER,
    logo: DEFILLAMA_LOGO_URL,
    category: DEFILLAMA_CATEGORY,
  } as const;
}
