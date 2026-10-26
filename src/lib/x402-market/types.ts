export type X402ListingType =
  | "Agent Skill" | "API Endpoint" | "MCP Server" | "Data Feed"
  | "Automation Tool" | "Research Tool" | "Trading Tool" | "Security Scanner";
export type X402MarketListingSource = "curated" | "native" | "published" | "inference" | "external";
export type X402MarketListing = {
  id: string;
  title: string;
  owner: string;
  ownerHref?: string;
  summary: string;
  type: X402ListingType;
  category: string;
  price: string;
  network: string;
  paymentTokens: string[];
  reputation: number;
  endpointCount: number;
  status: "Verified" | "Unverified";
  docsHref: string;
  callSnippet: string;
  requestHref: string;
  isX402MarketEligible: true;
  source: X402MarketListingSource;
  openHref: string;
  payPrompt: string;
  method: string;
  tags: string[];
  sourceLabel: string;
  statusOnline: boolean;
};
export const X402_PAYMENT_TOKENS = ["SOL", "USDC", "AR"] as const;
export function clampReputationScore(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}
export function inferPaymentTokens(text: string): string[] {
  const hay = text.toUpperCase();
  const tokens = X402_PAYMENT_TOKENS.filter((token) => {
    if (token === "SOL") return /\bSOL(?:ANA)?\b/.test(hay);
    return new RegExp(`\\b${token}\\b`).test(hay);
  });
  return tokens.length ? [...tokens] : ["USDC"];
}
export function inferListingType(title: string, summary: string): X402ListingType {
  const hay = `${title} ${summary}`.toLowerCase();
  if (hay.includes("mcp")) return "MCP Server";
  if (/security|risk|audit/.test(hay)) return "Security Scanner";
  if (/feed|data/.test(hay)) return "Data Feed";
  if (/trade|token|market/.test(hay)) return "Trading Tool";
  if (/research|summar/.test(hay)) return "Research Tool";
  if (/automation|bot/.test(hay)) return "Automation Tool";
  if (/api|endpoint/.test(hay)) return "API Endpoint";
  return "Agent Skill";
}
export function inferCategory(title: string, summary: string): string {
  const hay = `${title} ${summary}`.toLowerCase();
  if (/security|risk|audit/.test(hay)) return "Security";
  if (/trade|token|market/.test(hay)) return "Trading";
  if (/metadata|seo/.test(hay)) return "SEO";
  if (/research|summar/.test(hay)) return "Research";
  if (/automation|bot/.test(hay)) return "Automation";
  if (/reputation|trust/.test(hay)) return "Reputation";
  return "Data";
}
