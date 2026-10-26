import type { TokenMarketSnapshot } from "@/lib/public-site/dexscreener";
import type { PumpFunBondingData } from "@/lib/public-site/pumpfun-bonding";
import {
  normalizeTelegramUrl,
  normalizeTwitterUrl,
} from "@/lib/agent-launch/metadata-token-json";
export type TokenCardSocials = {
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};
/** Prefer DexScreener; fall back to Pump.fun MCAP/ATH when bonding or Dex is thin. */
export function resolveTokenCardMarket(
  market: TokenMarketSnapshot | null,
  pumpFun: PumpFunBondingData | null,
): TokenMarketSnapshot | null {
  if (market) {
    const needsMcap = market.marketCapUsd == null && market.fdvUsd == null;
    const needsAth = market.athMarketCapUsd == null;
    const needsPrice = market.priceUsd == null;
    if (
      pumpFun &&
      ((needsMcap && pumpFun.marketCapUsd != null) ||
        (needsAth && pumpFun.athMarketCapUsd != null) ||
        (needsPrice && pumpFun.priceUsd != null))
    ) {
      return {
        ...market,
        marketCapUsd:
          market.marketCapUsd ?? (needsMcap ? pumpFun.marketCapUsd : null),
        priceUsd: market.priceUsd ?? pumpFun.priceUsd,
        athMarketCapUsd: market.athMarketCapUsd ?? pumpFun.athMarketCapUsd,
      };
    }
    return market;
  }
  if (!pumpFun) return null;
  return {
    source: "pumpfun",
    chainId: "solana",
    pairAddress: null,
    pairUrl: null,
    dexId: null,
    priceUsd: pumpFun.priceUsd,
    marketCapUsd: pumpFun.marketCapUsd,
    fdvUsd: null,
    volume24hUsd: null,
    liquidityUsd: null,
    priceChange24hPct: null,
    txns24hBuys: null,
    txns24hSells: null,
    baseSymbol: pumpFun.symbol || null,
    quoteSymbol: null,
    pairCreatedAt: null,
    athMarketCapUsd: pumpFun.athMarketCapUsd,
    rawUpdatedAt: new Date().toISOString(),
  };
}
function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return null;
}
type SocialSource = {
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
};
/** First non-empty normalized social wins per network. */
export function resolveTokenCardSocials(
  ...sources: ReadonlyArray<SocialSource | null | undefined>
): TokenCardSocials {
  let twitter: string | null = null;
  let telegram: string | null = null;
  let website: string | null = null;
  for (const source of sources) {
    if (!source) continue;
    if (!twitter) twitter = normalizeTwitterUrl(source.twitter);
    if (!telegram) telegram = normalizeTelegramUrl(source.telegram);
    if (!website) website = normalizeWebsiteUrl(source.website);
  }
  return { twitter, telegram, website };
}
export function tokenCardSocialsHaveAny(socials: TokenCardSocials | null | undefined): boolean {
  if (!socials) return false;
  return Boolean(socials.twitter || socials.telegram || socials.website);
}
