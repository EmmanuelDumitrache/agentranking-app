import type { StepResult, ToolSet } from "ai";
import { usdAmountToMicros } from "./costing";
import type { NormalizedProviderUsage } from "./types";

type OpenRouterProviderMetadata = {
  id?: string;
  usage?: { cost?: number | string; totalTokens?: number };
  cost?: number | string;
};

export type ProviderUsageResult = Pick<
  StepResult<ToolSet>,
  "usage" | "providerMetadata" | "response"
>;

export function normalizeProviderUsage(result: ProviderUsageResult): NormalizedProviderUsage {
  const usage = result.usage;
  const openrouter = result.providerMetadata?.openrouter as
    | OpenRouterProviderMetadata
    | undefined;
  const input = _uint(usage.inputTokens);
  const output = _uint(usage.outputTokens);
  const reasoning = _uint(usage.outputTokenDetails?.reasoningTokens);
  const cachedInput = _uint(usage.inputTokenDetails?.cacheReadTokens);
  const cacheWrite = _uint(usage.inputTokenDetails?.cacheWriteTokens);
  const total = _uint(usage.totalTokens) || Math.max(input + output, 0);

  let providerCostUsdMicros: bigint | undefined;
  const orCost = openrouter?.usage?.cost ?? openrouter?.cost;
  if (orCost !== undefined) {
    const parsed = parseUsdMicros(String(orCost));
    if (parsed !== undefined) providerCostUsdMicros = parsed;
  }

  const providerRequestId = openrouter?.id ?? result.response?.id;
  return {
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    cachedInputTokens: cachedInput,
    cacheWriteTokens: cacheWrite,
    totalTokens: total,
    providerCostUsdMicros,
    providerRequestId,
  };
}

function _uint(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function parseUsdMicros(cost: string): bigint | undefined {
  try {
    return usdAmountToMicros(cost);
  } catch {
    return undefined;
  }
}
