import {
  calculateRunCostUsdMicros,
  usdMicrosToChargeCents,
  type ProviderPricing,
} from "./costing";
import type { AgentChatModelDefinition } from "@/features/agent-chat/shared/model-registry-types";
export const TOOL_STEP_OVERHEAD_TOKENS = 1_200;
const ONE = BigInt(1);
const SAFETY_FACTOR_NUMERATOR = BigInt(13);
const SAFETY_FACTOR_DENOMINATOR = BigInt(10);
export const RESERVATION_PRICING_REVISION = "exact-microusd-attempts";
export type ReservationEstimate = {
  reservedCents: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  pricingRevision: typeof RESERVATION_PRICING_REVISION;
};
function maxPrice(
  models: readonly AgentChatModelDefinition[],
  field: keyof ProviderPricing,
): number {
  return models.reduce((max, model) => {
    const value = model.pricing[field as keyof typeof model.pricing];
    return typeof value === "number" ? Math.max(max, value) : max;
  }, 0);
}
/** Reserve against the most expensive eligible route, not only the requested model. */
export function estimateRouteReservation(
  models: readonly AgentChatModelDefinition[],
  estimatedInputTokens: number,
  maxToolSteps: number,
): ReservationEstimate {
  if (!models.length) throw new Error("At least one routed model is required");
  const estimatedOutputTokens = Math.max(
    ...models.map((model) => model.maxOutputTokens),
  );
  const inputTokens = Math.max(
    1,
    estimatedInputTokens + maxToolSteps * TOOL_STEP_OVERHEAD_TOKENS,
  );
  const pricing: ProviderPricing = {
    inputUsdMicrosPerMillion: maxPrice(models, "inputUsdMicrosPerMillion"),
    outputUsdMicrosPerMillion: maxPrice(models, "outputUsdMicrosPerMillion"),
    cachedInputUsdMicrosPerMillion: maxPrice(
      models,
      "cachedInputUsdMicrosPerMillion",
    ),
    cacheWriteUsdMicrosPerMillion: maxPrice(
      models,
      "cacheWriteUsdMicrosPerMillion",
    ),
    reasoningUsdMicrosPerMillion: maxPrice(
      models,
      "reasoningUsdMicrosPerMillion",
    ),
  };
  const rawMicros = calculateRunCostUsdMicros(
    {
      inputTokens,
      outputTokens: estimatedOutputTokens,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    },
    pricing,
  );
  const paddedMicros =
    (rawMicros * SAFETY_FACTOR_NUMERATOR + SAFETY_FACTOR_DENOMINATOR - ONE) /
    SAFETY_FACTOR_DENOMINATOR;
  const paidPricing = Object.values(pricing).some(
    (value) => Number(value ?? 0) > 0,
  );
  return {
    reservedCents: usdMicrosToChargeCents(paddedMicros, {
      paidPricing,
      totalTokens: inputTokens + estimatedOutputTokens,
    }),
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens,
    pricingRevision: RESERVATION_PRICING_REVISION,
  };
}
