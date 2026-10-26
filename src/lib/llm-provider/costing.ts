import type { NormalizedProviderUsage } from "./types";
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
const TOKENS_PER_MILLION = BigInt(1_000_000);
const MICROS_PER_CENT = BigInt(10_000);
const MAX_CHARGE_CENTS = 50_000;
export type ProviderPricing = {
  inputUsdMicrosPerMillion: number | bigint;
  outputUsdMicrosPerMillion: number | bigint;
  cachedInputUsdMicrosPerMillion?: number | bigint;
  cacheWriteUsdMicrosPerMillion?: number | bigint;
  reasoningUsdMicrosPerMillion?: number | bigint;
};
function nonNegativeInt(value: number | undefined): bigint {
  return BigInt(Math.max(0, Math.trunc(value ?? 0)));
}
function price(
  value: number | bigint | undefined,
  fallback: number | bigint,
): bigint {
  if (typeof value === "bigint") return value > ZERO ? value : ZERO;
  if (typeof value === "number") {
    return BigInt(Math.max(0, Math.trunc(value)));
  }
  return typeof fallback === "bigint"
    ? fallback > ZERO
      ? fallback
      : ZERO
    : BigInt(Math.max(0, Math.trunc(fallback)));
}
function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
/**
 * Exact integer-micro-USD cost for one physical provider attempt.
 *
 * AI SDK token details are subsets of the corresponding total token counts:
 * cache-read/write tokens are included in inputTokens and reasoning tokens are
 * included in outputTokens. Split those totals before applying differentiated
 * rates so cached/reasoning usage is never billed twice.
 */
export function calculateRunCostUsdMicros(
  usage: Pick<
    NormalizedProviderUsage,
    | "inputTokens"
    | "outputTokens"
    | "reasoningTokens"
    | "cachedInputTokens"
    | "cacheWriteTokens"
  >,
  pricing: ProviderPricing,
): bigint {
  const inputPrice = price(pricing.inputUsdMicrosPerMillion, 0);
  const outputPrice = price(pricing.outputUsdMicrosPerMillion, 0);
  const cachedPrice = price(pricing.cachedInputUsdMicrosPerMillion, inputPrice);
  const cacheWritePrice = price(
    pricing.cacheWriteUsdMicrosPerMillion,
    inputPrice,
  );
  const reasoningPrice = price(
    pricing.reasoningUsdMicrosPerMillion,
    outputPrice,
  );
  const totalInput = nonNegativeInt(usage.inputTokens);
  const cachedInput = minBigInt(
    nonNegativeInt(usage.cachedInputTokens),
    totalInput,
  );
  const cacheWrite = minBigInt(
    nonNegativeInt(usage.cacheWriteTokens),
    totalInput - cachedInput,
  );
  const uncachedInput = totalInput - cachedInput - cacheWrite;
  const totalOutput = nonNegativeInt(usage.outputTokens);
  const reasoning = minBigInt(
    nonNegativeInt(usage.reasoningTokens),
    totalOutput,
  );
  const textOutput = totalOutput - reasoning;
  const costNumerator =
    uncachedInput * inputPrice +
    cachedInput * cachedPrice +
    cacheWrite * cacheWritePrice +
    textOutput * outputPrice +
    reasoning * reasoningPrice;
  if (costNumerator <= ZERO) return ZERO;
  return (costNumerator + TOKENS_PER_MILLION - ONE) / TOKENS_PER_MILLION;
}
export function usdMicrosToChargeCents(
  usdMicros: bigint,
  options: { paidPricing: boolean; totalTokens: number },
): number {
  if (usdMicros <= ZERO) return 0;
  const rounded = Number((usdMicros + MICROS_PER_CENT - ONE) / MICROS_PER_CENT);
  const minimum = options.paidPricing && options.totalTokens > 0 ? 1 : 0;
  return Math.min(MAX_CHARGE_CENTS, Math.max(minimum, rounded));
}
/** Parse a non-negative decimal/scientific amount at a fixed decimal scale. */
export function decimalAmountToScaledInteger(
  value: string | number,
  decimalPlaces: number,
): bigint {
  if (
    !Number.isSafeInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 100
  ) {
    throw new Error(`Invalid decimal scale: ${decimalPlaces}`);
  }
  const raw = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new Error(`Invalid decimal amount: ${raw}`);
  const whole = match[1];
  const fraction = match[2] ?? "";
  const exponent = Number.parseInt(match[3] ?? "0", 10);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10_000) {
    throw new Error(`Invalid decimal amount: ${raw}`);
  }
  const coefficient = BigInt(`${whole}${fraction}`);
  const sourceScale = fraction.length - exponent;
  const targetShift = decimalPlaces - sourceScale;
  if (targetShift >= 0) {
    return coefficient * TEN ** BigInt(targetShift);
  }
  return coefficient / TEN ** BigInt(-targetShift);
}
/** Parse a non-negative decimal/scientific USD amount into integer micro-USD. */
export function usdAmountToMicros(value: string | number): bigint {
  return decimalAmountToScaledInteger(value, 6);
}