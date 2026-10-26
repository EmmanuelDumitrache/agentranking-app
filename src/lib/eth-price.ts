import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { getExternalProviderCached } from "@/lib/external-provider-cache";

const CoinGeckoEthSchema = z.object({
  ethereum: z.object({
    usd: z.number().positive(),
  }),
});

const BinanceEthSchema = z.object({
  price: z.string().transform((val) => Number.parseFloat(val)),
});

const ETH_USD_CACHE_KEY = "market-price:eth-usd";
const ETH_USD_FRESH_TTL_SECONDS = 60;
const ETH_USD_STALE_TTL_SECONDS = 15 * 60;
const ETH_USD_MAX_PAYLOAD_BYTES = 1_024;

class EthPriceUnavailableError extends AggregateError {
  constructor(errors: unknown[]) {
    super(errors, "All ETH/USD market-data providers failed");
    this.name = "EthPriceUnavailableError";
  }
}

const ETH_PRICE_PROVIDERS = [
  async (): Promise<number> => {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) throw new Error(`CoinGecko ETH price fetch failed with HTTP ${res.status}`);
    const json = await parseBoundedJsonBody(res, CoinGeckoEthSchema, 128 * 1_024);
    const price = json.ethereum.usd;
    if (!isPositivePrice(price)) throw new Error("Invalid CoinGecko ETH/USD price");
    return price;
  },
  async (): Promise<number> => {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDC",
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!res.ok) throw new Error(`Binance ETH price fetch failed with HTTP ${res.status}`);
    const json = await parseBoundedJsonBody(res, BinanceEthSchema, 128 * 1_024);
    const price = json.price;
    if (!isPositivePrice(price)) throw new Error("Invalid Binance ETH/USD price");
    return price;
  },
];

function isPositivePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function fetchFreshEthUsdPrice(): Promise<number> {
  const errors: unknown[] = [];
  for (const provider of ETH_PRICE_PROVIDERS) {
    try {
      return await provider();
    } catch (error) {
      errors.push(error);
    }
  }
  throw new EthPriceUnavailableError(errors);
}

/** Get ETH/USD from a lease-coordinated shared snapshot. */
export async function getEthUsdPrice(): Promise<number | null> {
  try {
    const result = await getExternalProviderCached({
      key: ETH_USD_CACHE_KEY,
      validate: isPositivePrice,
      freshTtlSeconds: ETH_USD_FRESH_TTL_SECONDS,
      staleTtlSeconds: ETH_USD_STALE_TTL_SECONDS,
      maxPayloadBytes: ETH_USD_MAX_PAYLOAD_BYTES,
      leaseTtlMs: 15_000,
      load: () => fetchFreshEthUsdPrice(),
    });
    return result.value;
  } catch (error) {
    if (error instanceof EthPriceUnavailableError) return null;
    throw error;
  }
}
