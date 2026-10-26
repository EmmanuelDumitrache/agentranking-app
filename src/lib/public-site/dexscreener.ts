import { readBoundedJsonBody } from "@/lib/bounded-http-body";
import { getOrInsertComputed } from "@/lib/map-upsert";
export type TokenMarketSnapshot = {
  source: "dexscreener" | "pumpfun";
  chainId: string;
  pairAddress: string | null;
  pairUrl: string | null;
  dexId: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  priceChange24hPct: number | null;
  txns24hBuys: number | null;
  txns24hSells: number | null;
  baseSymbol: string | null;
  quoteSymbol: string | null;
  pairCreatedAt: string | null;
  /** All-time high market cap in USD when available (e.g. Pump.fun). */
  athMarketCapUsd: number | null;
  /** ISO timestamp from DexScreener's pair.updatedAt field, or our fetch time. */
  rawUpdatedAt: string;
};
/** DexScreener raw pair — only fields we extract. */
type DexPairRaw = {
  chainId: string;
  dexId?: string;
  pairAddress: string;
  url?: string;
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  baseToken?: { symbol?: string; address?: string };
  quoteToken?: { symbol?: string; address?: string };
  pairCreatedAt?: number;
};
const CACHE_TTL_SECONDS = 30;
const DEXSCREENER_TOKENS_API = "https://api.dexscreener.com/tokens/v1";
export type DexscreenerChainId = "solana" | "robinhood";
/** Fetch DexScreener market data for a single Solana mint. */
export async function getDexscreenerMarketForMint(mint: string): Promise<TokenMarketSnapshot | null> {
  const snapshot = await getDexscreenerMarketsForAddresses("solana", [mint]);
  return snapshot.get(mint) ?? null;
}
/** Fetch DexScreener market data for a Robinhood Chain token address. */
export async function getDexscreenerMarketForRobinhoodToken(
  tokenAddress: string,
): Promise<TokenMarketSnapshot | null> {
  const key = tokenAddress.trim();
  if (!key) return null;
  const snapshot = await getDexscreenerMarketsForAddresses("robinhood", [key]);
  for (const [addr, value] of snapshot) {
    if (addr.toLowerCase() === key.toLowerCase()) return value;
  }
  return null;
}
/** Batch-fetch DexScreener market data for up to 30 Solana mints. */
export async function getDexscreenerMarketsForMints(
  mints: ReadonlyArray<string>,
): Promise<Map<string, TokenMarketSnapshot>> {
  return getDexscreenerMarketsForAddresses("solana", mints);
}
const DEXSCREENER_ADDRESS_CHUNK = 30;
/** Batch-fetch DexScreener market data for token addresses on a chain (chunked). */
export async function getDexscreenerMarketsForAddresses(
  chainId: DexscreenerChainId,
  addresses: ReadonlyArray<string>,
): Promise<Map<string, TokenMarketSnapshot>> {
  const results = new Map<string, TokenMarketSnapshot>();
  const unique = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
  if (unique.length === 0) return results;
  for (let i = 0; i < unique.length; i += DEXSCREENER_ADDRESS_CHUNK) {
    const chunk = unique.slice(i, i + DEXSCREENER_ADDRESS_CHUNK);
    const chunkResults = await fetchDexscreenerChunk(chainId, chunk);
    for (const [addr, snapshot] of chunkResults) {
      results.set(addr, snapshot);
    }
  }
  return results;
}
async function fetchDexscreenerChunk(
  chainId: DexscreenerChainId,
  addresses: readonly string[],
): Promise<Map<string, TokenMarketSnapshot>> {
  const results = new Map<string, TokenMarketSnapshot>();
  if (addresses.length === 0) return results;
  const addressList = addresses.join(",");
  const url = `${DEXSCREENER_TOKENS_API}/${chainId}/${addressList}`;
  const knownLower = new Map(addresses.map((a) => [a.toLowerCase(), a] as const));
  try {
    const res = await fetch(url, {
      next: { revalidate: CACHE_TTL_SECONDS },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return results;
    const data = await readBoundedJsonBody(res, 4 * 1024 * 1024);
    if (!Array.isArray(data)) return results;
    const pairsByToken = new Map<string, DexPairRaw[]>();
    for (const item of data) {
      const pair = item as DexPairRaw;
      if (pair.chainId !== chainId) continue;
      const tokenAddr = tryExtractBaseTokenAddress(pair, addresses, knownLower);
      if (!tokenAddr) continue;
      getOrInsertComputed(pairsByToken, tokenAddr, () => []).push(pair);
    }
    for (const tokenAddr of addresses) {
      const pairs =
        pairsByToken.get(tokenAddr) ??
        [...pairsByToken.entries()].find(([k]) => k.toLowerCase() === tokenAddr.toLowerCase())?.[1];
      const best = pairs?.length ? selectBestPair(pairs) : null;
      if (best) {
        results.set(tokenAddr, mapDexPair(best));
      }
    }
  } catch {
    // DexScreener unavailable — return empty (caller shows "—")
  }
  return results;
}
function tryExtractBaseTokenAddress(
  pair: DexPairRaw,
  knownAddresses: readonly string[],
  knownLower: Map<string, string>,
): string | null {
  const baseAddr = pair.baseToken?.address ?? "";
  if (!baseAddr) return null;
  if (knownAddresses.includes(baseAddr)) return baseAddr;
  const canonical = knownLower.get(baseAddr.toLowerCase());
  if (canonical) return canonical;
  for (const addr of knownAddresses) {
    if (pair.url?.includes(addr) || pair.pairAddress?.toLowerCase() === addr.toLowerCase()) {
      return addr;
    }
  }
  return null;
}
/** Pick the best pair: highest USD liquidity → highest 24h volume → newest. */
function selectBestPair(pairs: DexPairRaw[]): DexPairRaw {
  return pairs.reduce((best, current) => {
    const bestLiq = best.liquidity?.usd ?? 0;
    const curLiq = current.liquidity?.usd ?? 0;
    if (curLiq > bestLiq) return current;
    if (curLiq < bestLiq) return best;
    const bestVol = best.volume?.h24 ?? 0;
    const curVol = current.volume?.h24 ?? 0;
    if (curVol > bestVol) return current;
    if (curVol < bestVol) return best;
    const bestTs = best.pairCreatedAt ?? 0;
    const curTs = current.pairCreatedAt ?? 0;
    return curTs > bestTs ? current : best;
  });
}
function mapDexPair(pair: DexPairRaw): TokenMarketSnapshot {
  const priceUsd = parseOptionalFloat(pair.priceUsd);
  return {
    source: "dexscreener",
    chainId: pair.chainId,
    pairAddress: pair.pairAddress ?? null,
    pairUrl: pair.url ?? null,
    dexId: pair.dexId ?? null,
    priceUsd,
    marketCapUsd: pair.marketCap ?? null,
    fdvUsd: pair.fdv ?? null,
    volume24hUsd: pair.volume?.h24 ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    priceChange24hPct: pair.priceChange?.h24 ?? null,
    txns24hBuys: pair.txns?.h24?.buys ?? null,
    txns24hSells: pair.txns?.h24?.sells ?? null,
    baseSymbol: pair.baseToken?.symbol ?? null,
    quoteSymbol: pair.quoteToken?.symbol ?? null,
    pairCreatedAt: pair.pairCreatedAt ? String(pair.pairCreatedAt) : null,
    athMarketCapUsd: null,
    rawUpdatedAt: new Date().toISOString(),
  };
}
function parseOptionalFloat(value: string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
