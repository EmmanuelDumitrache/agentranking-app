import { AsyncLocalStorage } from "node:async_hooks";
export type RetryReason =
  | "provider_switch"
  | "rate_limit"
  | "transport_failure"
  | "provider_lag"
  | "archive_unavailable"
  | "authentication"
  | "unknown";
export class RetryBudgetExceededError extends Error {
  readonly code = "RETRY_BUDGET_EXHAUSTED";
  constructor(readonly dimension: string, readonly snapshot: RetryBudgetSnapshot) {
    super(`Retry budget exhausted: ${dimension}`);
    this.name = "RetryBudgetExceededError";
  }
}
export type RetryBudgetSnapshot = {
  totalAttempts: number;
  providerSwitches: number;
  elapsedMs: number;
  cumulativeDelayMs: number;
  cumulativeRpcWeight: number;
  reasons: Record<string, number>;
};
export class RetryBudget {
  readonly startedAt = Date.now();
  #totalAttempts = 0;
  #providerSwitches = 0;
  #providerSwitchesByScope = new Map<string, number>();
  #attemptsByScope = new Map<string, number>();
  #retryStartedAtByScope = new Map<string, number>();
  #cumulativeDelayMs = 0;
  #cumulativeRpcWeight = 0;
  #reasons = new Map<string, number>();
  constructor(readonly limits: {
    maxTotalAttempts: number;
    maxProviderSwitches: number;
    maxElapsedMs: number;
    maxCumulativeDelayMs: number;
    maxCumulativeRpcWeight: number;
  }) {}
  snapshot(): RetryBudgetSnapshot {
    return {
      totalAttempts: this.#totalAttempts,
      providerSwitches: this.#providerSwitches,
      elapsedMs: Date.now() - this.startedAt,
      cumulativeDelayMs: this.#cumulativeDelayMs,
      cumulativeRpcWeight: this.#cumulativeRpcWeight,
      reasons: Object.fromEntries(this.#reasons),
    };
  }
  consumeAttempt(reason: RetryReason | string, scope = "job", candidateFloor = 0): void {
    this.#assertRetryElapsed(scope);
    this.#totalAttempts += 1;
    const scoped = (this.#attemptsByScope.get(scope) ?? 0) + 1;
    this.#attemptsByScope.set(scope, scoped);
    this.#reasons.set(reason, (this.#reasons.get(reason) ?? 0) + 1);
    // A worker job performs many independent RPC operations and may legitimately run longer
    // than one fallback episode. Apply attempt ceilings per logical operation while retaining
    // the aggregate count for observability and cumulative weight enforcement.
    const effectiveLimit = Math.max(this.limits.maxTotalAttempts, Math.max(0, Math.trunc(candidateFloor)));
    if (scoped > effectiveLimit) this.#fail("total attempts");
  }
  consumeRpcWeight(rpcWeight: number): void {
    // This budget measures failed/retried RPC work only. Successful indexing requests are useful
    // progress and must not terminate a long-running backfill merely because it performed many
    // healthy calls. The transport charges this method only after a request failure.
    this.#cumulativeRpcWeight += Math.max(0, Math.ceil(rpcWeight));
    if (this.#cumulativeRpcWeight > this.limits.maxCumulativeRpcWeight) this.#fail("cumulative failed RPC weight");
  }
  consumeProviderSwitch(scope = "job", candidateFloor = 0): void {
    this.#assertRetryElapsed(scope);
    this.#providerSwitches += 1;
    const scoped = (this.#providerSwitchesByScope.get(scope) ?? 0) + 1;
    this.#providerSwitchesByScope.set(scope, scoped);
    this.#reasons.set("provider_switch", (this.#reasons.get("provider_switch") ?? 0) + 1);
    // Provider pools are traversed independently for each logical RPC operation.
    // Applying this ceiling across an entire multi-chunk indexing job causes healthy
    // later chunks to inherit switches spent by earlier calls. Enforce the configured
    // limit per operation while retaining the aggregate count for observability.
    // A logical operation must be allowed to inspect every currently configured candidate at
    // least once. This prevents a stale low environment value from truncating a larger provider
    // pool before its healthy endpoint is reached, while preserving the configured ceiling for
    // repeated retry episodes beyond one traversal.
    const effectiveLimit = Math.max(this.limits.maxProviderSwitches, Math.max(0, Math.trunc(candidateFloor)));
    if (scoped > effectiveLimit) this.#fail("provider switches");
  }
  consumeDelay(delayMs: number, scope = "job"): void {
    this.#assertRetryElapsed(scope);
    this.#cumulativeDelayMs += Math.max(0, Math.trunc(delayMs));
    if (this.#cumulativeDelayMs > this.limits.maxCumulativeDelayMs) this.#fail("cumulative delay");
  }
  #assertRetryElapsed(scope: string): void {
    const now = Date.now();
    const startedAt = this.#retryStartedAtByScope.get(scope) ?? now;
    if (!this.#retryStartedAtByScope.has(scope)) this.#retryStartedAtByScope.set(scope, startedAt);
    if (now - startedAt > this.limits.maxElapsedMs) this.#fail("elapsed time");
  }
  #fail(dimension: string): never {
    throw new RetryBudgetExceededError(dimension, this.snapshot());
  }
}
type JobRuntimeContext = {
  queueName: string;
  signal?: AbortSignal;
  rpcPriority: number;
  retryBudget: RetryBudget;
  touchProgress?: () => void;
};
const storage = new AsyncLocalStorage<JobRuntimeContext>();
export function runWithJobRuntime<T>(context: JobRuntimeContext, operation: () => Promise<T>): Promise<T> {
  return storage.run(context, operation);
}
export function currentJobRuntime(): JobRuntimeContext | undefined {
  return storage.getStore();
}
export function currentRetryBudget(): RetryBudget | undefined {
  return storage.getStore()?.retryBudget;
}
