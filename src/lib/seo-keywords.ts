/**
 * Curated SEO keywords — single source for meta `keywords` across layouts.
 * Keep aligned with Search Dashboard query themes (on-chain AI, ERC-8004, x402, chains).
 */
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
/** Site-wide primary terms (home, default). */
export const SEO_PRIMARY_KEYWORDS = [
  "Synapse Agent Protocol",
  "SAP agents",
  "Solana AI agent discovery",
  "OOBE Synapse Agent Protocol",
  "on-chain AI agents",
  "ERC-8004 agents",
  "blockchain AI agent directory",
  "verified AI agents",
  "AI agent rankings",
  "Ethereum AI agents",
  "Base network AI agents",
  "Solana AI agents",
  "EVM and Solana agents",
  "AI agents",
  "on-chain agents",
  "AgentRanking",
  "multi-chain",
  "blockchain AI",
  "AI agent directory",
  "agent ranking",
  "AI agent rankings",
  "crypto agents",
  "crypto AI agents",
  "stake $AR",
  "agent staking",
  "Ethereum",
  "Base",
  "Polygon",
  "BNB Chain",
  "Arbitrum",
  "Optimism",
  "ERC-8004",
  "ERC-8004 agents",
  "x402",
  "x402 AI agent",
  "crypto AI agents",
  "autonomous agents",
  "agent registry",
  "verify AI agent",
  "AI agent leaderboard",
  "Agent Dashboard",
  "x402 Market",
  "MCP Jobs",
  "agent economy analytics",
] as const;
function dedupeKeywords(parts: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const k = raw.trim();
    if (!k) continue;
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  return out;
}
/** Keywords dedicated to Synapse SAP / OOBE discovery hubs — omitted. */
export function getSapSeoKeywords(): undefined {
  return undefined;
}
/** Keywords for a chain hub `/networks/[chainId]`. */
export function getChainHubKeywords(chainName: string, shortName?: string, chainId?: number): string[] {
  const chain = chainName.trim() || "blockchain";
  const shorty = shortName?.trim();
  const isSolana = chainId === SOLANA_CHAIN_ID;
  const base = dedupeKeywords([
    ...SEO_PRIMARY_KEYWORDS,
    `AI agents on ${chain}`,
    `${chain} AI agents`,
    `on-chain agents ${chain}`,
    "blockchain AI",
    "agent directory",
    ...(shorty && shorty !== chain ? [`${shorty} agents`, `AI agents ${shorty}`] : []),
  ]);
  if (isSolana) {
    return dedupeKeywords([
      ...base,
      "Solana agents",
      "Solana on-chain AI",
      "Solana agent registry",
      "Quantu indexer",
    ]);
  }
  return dedupeKeywords([...base, "ERC-8004"]);
}
/** Merge global keywords with route-specific terms — omitted. */
export function mergeWithGlobal(..._extra: string[]): undefined {
  return undefined;
}
export const SEO_EXTRA_NEW = [
  "new AI agents",
  "latest agents",
  "recently listed agents",
] as const;
export const SEO_EXTRA_NEWS = [
  "ERC-8004 news",
  "blockchain AI news",
  "AI agent ecosystem",
] as const;
/** Public-site marketing homepage keywords — omitted. */
export function getPublicHomeKeywords(): undefined {
  return undefined;
}
