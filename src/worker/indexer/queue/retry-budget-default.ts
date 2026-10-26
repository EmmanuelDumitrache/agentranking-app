import { config } from "../config.js";
import { RetryBudget } from "./retry-budget.js";
export function createDefaultRetryBudget(): RetryBudget {
  return new RetryBudget({
    maxTotalAttempts: Math.max(1, config.maxAttempts * 8, config.rpcRetryMaxProviderSwitches + 8),
    maxProviderSwitches: config.rpcRetryMaxProviderSwitches,
    maxElapsedMs: config.rpcRetryMaxElapsedMs,
    maxCumulativeDelayMs: config.rpcRetryMaxCumulativeDelayMs,
    maxCumulativeRpcWeight: config.rpcRetryMaxCumulativeWeight,
  });
}