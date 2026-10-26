import { z } from "zod";
import { mapWithConcurrency } from "@/lib/async-pool";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
/**
 * Pump.fun bonding-curve data fetcher.
 *
 * Used when a token is still on the bonding curve (hasn't graduated to
 * Raydium) and DexScreener has no pair data.
 */
const PUMPFUN_API_BASE = "https://frontend-api-v3.pump.fun";

const PumpFunCoinRawSchema = z.object({
  mint: z.string(),
  initialized: z.boolean().optional(),
  name: z.string().optional(),
  symbol: z.string().optional(),
  image_uri: z.string().optional(),
  market_cap: z.number().optional(),
  market_cap_quote: z.number().optional(),
  usd_market_cap: z.number().optional(),
  virtual_sol_reserves: z.number().optional(),
  virtual_token_reserves: z.number().optional(),
  total_supply: z.number().optional(),
  complete: z.boolean().optional(),
  creator: z.string().optional(),
  created_timestamp: z.number().optional(),
  ath_market_cap: z.number().optional(),
  twitter: z.string().optional(),
  telegram: z.string().optional(),
  website: z.string().optional(),
});

type PumpFunCoinRaw = z.infer<typeof PumpFunCoinRawSchema>;

export type PumpFunBondingData = {
  source: "pumpfun";
  /** Token mint address */
  mint: string;
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** IPFS / image URI */
  imageUri: string | null;
  /** Market cap in USD (from Pump.fun v3 usd_market_cap — live, accurate) */
  marketCapUsd: number | null;
  /** Price in USD — derived from usd_market_cap / total_supply */
  priceUsd: number | null;
  /** SOL/USD price implied by Pump.fun's USD market cap vs SOL market cap */
  solPriceUsd: number | null;
  /** Whether the token has graduated to Raydium */
  graduated: boolean;
  /** Bonding-curve progress 0–100 (percentage to graduation threshold) */
  bondingProgressPct: number | null;
  /** SOL bonded beyond Pump.fun's 30 SOL seed (actual buyer-supplied SOL) */
  bondingSol: number | null;
  /** Total SOL in the bonding curve (seed + bonded, from virtual_sol_reserves) */
  totalVirtualSol: number | null;
  /** Pump.fun coin page URL */
  url: string;
  /** Creator address */
  creator: string | null;
  /** Created timestamp (ISO string) */
  createdAt: string | null;
  /** All-time high market cap in USD (Pump.fun `ath_market_cap`) */
  athMarketCapUsd: number | null;
  /** Social links from token metadata (Pump.fun v3 API) */
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};
/** ~85 SOL graduation threshold for Pump.fun */
const GRADUATION_SOL_THRESHOLD = 85;
/** Pump.fun seeds each curve with 30 SOL — this is not bonded progress. */
const INITIAL_VIRTUAL_SOL = 30;
/** 1 SOL in lamports */
const LAMPORTS_PER_SOL = 1_000_000_000;
function mapPumpFunCoin(raw: PumpFunCoinRaw): PumpFunBondingData {
  const virtualSolReserves = raw.virtual_sol_reserves ?? 0;
  const totalVirtualSol = virtualSolReserves / LAMPORTS_PER_SOL;
  // Market cap USD: use Pump.fun v3 `usd_market_cap` (live, accurate USD
  // value). The old `market_cap` / `market_cap_quote` fields are SOL-
  // denominated and should not be shown as USD.
  const marketCapUsd = raw.usd_market_cap ?? null;
  const marketCapQuote = raw.market_cap_quote ?? raw.market_cap ?? null;
  const totalSupply = raw.total_supply ?? 0;
  // Price per token in USD: usd_market_cap / total_supply
  const priceUsd =
    marketCapUsd != null && totalSupply > 0
      ? marketCapUsd / totalSupply
      : null;
  // Implied SOL/USD price from Pump.fun's own feed:
  // usd_market_cap / market_cap_quote (SOL denominated)
  const solPriceUsd =
    marketCapUsd != null && marketCapQuote != null && marketCapQuote > 0
      ? marketCapUsd / marketCapQuote
      : null;
  // Bonded SOL beyond the 30 SOL seed: the actual buyer-supplied SOL.
  // Progress = additional bonded SOL / remaining range (55 SOL).
  const bondedSol = Math.max(0, totalVirtualSol - INITIAL_VIRTUAL_SOL);
  const progressRange = GRADUATION_SOL_THRESHOLD - INITIAL_VIRTUAL_SOL; // 55 SOL
  const bondingProgressPct = Math.min(
    100,
    Math.round((bondedSol / progressRange) * 100),
  );
  return {
    source: "pumpfun",
    mint: raw.mint,
    name: raw.name ?? "",
    symbol: raw.symbol ?? "",
    imageUri: raw.image_uri ?? null,
    marketCapUsd,
    priceUsd,
    solPriceUsd,
    graduated: raw.complete === true,
    bondingProgressPct: raw.complete === true ? 100 : bondingProgressPct,
    bondingSol: raw.complete === true ? progressRange : bondedSol,
    totalVirtualSol: raw.complete === true ? GRADUATION_SOL_THRESHOLD : totalVirtualSol,
    url: `https://pump.fun/coin/${raw.mint}`,
    creator: raw.creator ?? null,
    createdAt: raw.created_timestamp
      ? new Date(raw.created_timestamp).toISOString()
      : null,
    athMarketCapUsd:
      typeof raw.ath_market_cap === "number" && Number.isFinite(raw.ath_market_cap)
        ? raw.ath_market_cap
        : null,
    twitter: raw.twitter ?? null,
    telegram: raw.telegram ?? null,
    website: raw.website ?? null,
  };
}
/** Fetch bonding-curve data for a single mint from Pump.fun v3 API */
export async function getPumpFunBondingData(
  mint: string,
): Promise<PumpFunBondingData | null> {
  try {
    const resp = await fetch(`${PUMPFUN_API_BASE}/coins/${mint}`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const raw = await parseBoundedJsonBody(resp, PumpFunCoinRawSchema, 256 * 1024);
    if (!raw.initialized) return null;
    return mapPumpFunCoin(raw);
  } catch {
    return null;
  }
}
/** Batch-fetch bonding-curve data for multiple mints */
export async function getPumpFunBondingDataBatch(
  mints: ReadonlyArray<string>,
): Promise<Map<string, PumpFunBondingData>> {
  const results = new Map<string, PumpFunBondingData>();
  const values = await mapWithConcurrency(mints, 8, (mint) => getPumpFunBondingData(mint));
  values.forEach((value, index) => {
    if (value) results.set(mints[index]!, value);
  });
  return results;
}
