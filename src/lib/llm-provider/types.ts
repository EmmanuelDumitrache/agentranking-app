/** Canonical normalized provider usage for one physical inference attempt. */
export type NormalizedProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  providerCostUsdMicros?: bigint;
  providerRequestId?: string;
};