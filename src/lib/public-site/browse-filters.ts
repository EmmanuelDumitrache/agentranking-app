import type {
  PublicSiteMetricKey,
  PublicSiteTimeframeKey,
} from "@/components/public-site/public-site-browse-toolbar";
export function withinPublicSiteTimeframe(
  createdAt: string | null | undefined,
  timeframe: PublicSiteTimeframeKey,
): boolean {
  if (timeframe === "24h") return true;
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  return Date.now() - created <= 7 * 86_400_000;
}
export function parseLamports(value: string | null | undefined): bigint {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}
export type PublicSiteChainKey = "solana" | "robinhood" | "official";
export type PublicSiteSortable = {
  readonly createdAt: string | null | undefined;
  readonly volume24hUsd: number;
  readonly marketCapUsd: number;
  readonly fdvUsd: number;
  readonly hotScore: number;
  readonly solEarnedLamports: string | null | undefined;
  readonly isVerified: boolean;
  readonly chain?: PublicSiteChainKey;
};
export type LaunchTokenSearchFields = {
  readonly displayName: string;
  readonly tokenSymbol: string | null | undefined;
  readonly tokenName: string | null | undefined;
  readonly mint: string | null | undefined;
  readonly agentName: string | null | undefined;
};
/** Higher wins. Returns 0 when the query does not match. */
export function computeLaunchTokenSearchRelevance(
  token: LaunchTokenSearchFields,
  rawQuery: string,
): number {
  const raw = rawQuery.trim();
  if (!raw.length) return 0;
  const qLower = raw.toLowerCase();
  const qTicker = qLower.replace(/^\$/, "");
  const symbol = token.tokenSymbol?.trim().toLowerCase() ?? "";
  const name = token.displayName.trim().toLowerCase();
  const tokenName = token.tokenName?.trim().toLowerCase() ?? "";
  const agentName = token.agentName?.trim().toLowerCase() ?? "";
  const mint = token.mint?.trim() ?? "";
  if (mint && mint === raw) return 950_000;
  if (symbol && (symbol === qTicker || `$${symbol}` === qLower)) return 920_000;
  if (name === qLower) return 900_000;
  if (symbol?.startsWith(qTicker)) return 880_000 - Math.min(symbol.length, 499);
  if (name.startsWith(qLower)) return 860_000 - Math.min(name.length, 499);
  if (name.includes(qLower)) return 760_000 - Math.min(name.indexOf(qLower), 599);
  if (tokenName.includes(qLower)) return 680_000;
  if (agentName.includes(qLower)) return 660_000;
  if (symbol?.includes(qTicker)) return 640_000;
  if (raw.length >= 12 && mint.includes(raw)) return 530_000;
  return 0;
}
export function matchesPublicSiteChainFilter(
  chain: PublicSiteChainKey | undefined,
  metric: PublicSiteMetricKey,
): boolean {
  if (metric === "pumpfun") return chain === "solana" || chain === "official";
  if (metric === "robinhood") return chain === "robinhood";
  return true;
}
export function compareByPublicSiteMetric(
  a: PublicSiteSortable,
  b: PublicSiteSortable,
  metric: PublicSiteMetricKey,
): number {
  switch (metric) {
    case "mcap": {
      const aMcap = a.marketCapUsd || a.fdvUsd;
      const bMcap = b.marketCapUsd || b.fdvUsd;
      return bMcap - aMcap;
    }
    case "new":
    case "pumpfun":
    case "robinhood": {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return b.volume24hUsd - a.volume24hUsd;
    }
    case "verified": {
      const aVerified = a.isVerified ? 1 : 0;
      const bVerified = b.isVerified ? 1 : 0;
      if (aVerified !== bVerified) return bVerified - aVerified;
      return b.volume24hUsd - a.volume24hUsd;
    }
    case "volume":
      return b.volume24hUsd - a.volume24hUsd;
    default: {
      const _exhaustive: never = metric;
      return _exhaustive;
    }
  }
}
