import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { getExternalProviderCached } from "@/lib/external-provider-cache";

const JupiterPriceSchema = z.object({
  data: z.object({
    SOL: z.object({
      price: z.string().transform((val) => Number.parseFloat(val)),
    }),
  }),
});

const CoinGeckoSolSchema = z.object({
  solana: z.object({
    usd: z.number().positive(),
  }),
});

const SOL_USD_CACHE_KEY = "market-price:sol-usd";
const SOL_USD_FRESH_TTL_SECONDS = 60;
const SOL_USD_STALE_TTL_SECONDS = 15 * 60;
const SOL_USD_MAX_PAYLOAD_BYTES = 1_024;

class SolPriceUnavailableError extends AggregateError {
  constructor(errors: unknown[]) {
    super(errors, "All SOL/USD market-data providers failed");
    this.name = "SolPriceUnavailableError";
  }
}

const PRICE_PROVIDERS = [
  async (): Promise<number> => {
    const res = await fetch("https://price.jup.ag/v6/price?ids=SOL", {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`Jupiter price fetch failed with HTTP ${res.status}`);
    const json = await parseBoundedJsonBody(res, JupiterPriceSchema, 128 * 1_024);
    const price = json.data.SOL.price;
    if (!isPositivePrice(price)) throw new Error("Invalid Jupiter SOL/USD price");
    return price;
  },
  async (): Promise<number> => {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) throw new Error(`CoinGecko price fetch failed with HTTP ${res.status}`);
    const json = await parseBoundedJsonBody(res, CoinGeckoSolSchema, 128 * 1_024);
    const price = json.solana.usd;
    if (!isPositivePrice(price)) throw new Error("Invalid CoinGecko SOL/USD price");
    return price;
  },
];

function isPositivePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function fetchFreshSolUsdPrice(): Promise<number> {
  const errors: unknown[] = [];
  for (const provider of PRICE_PROVIDERS) {
    try {
      return await provider();
    } catch (error) {
      errors.push(error);
    }
  }
  throw new SolPriceUnavailableError(errors);
}

/** Get SOL/USD from a lease-coordinated shared snapshot. */
export async function getSolUsdPrice(): Promise<number | null> {
  try {
    const result = await getExternalProviderCached({
      key: SOL_USD_CACHE_KEY,
      validate: isPositivePrice,
      freshTtlSeconds: SOL_USD_FRESH_TTL_SECONDS,
      staleTtlSeconds: SOL_USD_STALE_TTL_SECONDS,
      maxPayloadBytes: SOL_USD_MAX_PAYLOAD_BYTES,
      leaseTtlMs: 15_000,
      load: () => fetchFreshSolUsdPrice(),
    });
    return result.value;
  } catch (error) {
    if (error instanceof SolPriceUnavailableError) return null;
    throw error;
  }
}
