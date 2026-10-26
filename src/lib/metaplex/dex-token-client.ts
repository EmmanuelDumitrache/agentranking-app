import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";

const MetaplexDexPairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  url: z.string(),
  pairAddress: z.string(),
  baseToken: z.object({ address: z.string(), name: z.string(), symbol: z.string() }),
  quoteToken: z.object({ name: z.string(), symbol: z.string() }),
  priceUsd: z.string().optional(),
  priceChange: z.object({ h24: z.number().optional() }).optional(),
  liquidity: z.object({ usd: z.number().optional() }).optional(),
  marketCap: z.number().optional(),
  fdv: z.number().optional(),
  volume: z.object({ h24: z.number().optional() }).optional(),
});

const DexPairsResponseSchema = z.object({
  pairs: z.array(MetaplexDexPairSchema).nullable().optional(),
});

export type MetaplexDexPair = z.infer<typeof MetaplexDexPairSchema>;

export function pickBestSolanaDexPair(
  pairs: readonly MetaplexDexPair[] | null | undefined,
): MetaplexDexPair | undefined {
  if (!pairs?.length) return undefined;
  const solana = pairs.filter((p) => p.chainId === "solana");
  const list = solana.length > 0 ? solana : [...pairs];
  return [...list].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
}
export async function fetchMetaplexDexPairs(mint: string): Promise<MetaplexDexPair[]> {
  const trimmed = mint.trim();
  if (!trimmed) return [];
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(trimmed)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return [];
  const data = await parseBoundedJsonBody(res, DexPairsResponseSchema, 4 * 1024 * 1024);
  return Array.isArray(data.pairs) ? data.pairs : [];
}
export function formatMetaplexTokenPrice(priceUsd: string | undefined): string {
  if (!priceUsd) return "—";
  const n = Number(priceUsd);
  if (!Number.isFinite(n)) return "—";
  if (n < 0.000001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
export function formatMetaplexUsdCompact(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}
/** Decorative bar heights from 24h change when OHLC history is unavailable. */
export function miniChartBarHeights(change24h: number | undefined, count = 12): number[] {
  const seed = change24h ?? 0;
  const trend = seed >= 0 ? 1 : -1;
  return Array.from({ length: count }, (_, i) => {
    const wave = Math.sin((i + 1) * 0.85 + seed * 0.02);
    const ramp = (i / Math.max(count - 1, 1)) * 0.35;
    const base = 0.28 + ramp + wave * 0.22;
    const biased = trend > 0 ? base + i * 0.025 : base - i * 0.015;
    return Math.max(0.12, Math.min(1, biased));
  });
}
