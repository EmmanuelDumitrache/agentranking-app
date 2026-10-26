export type ClientRetryContext = {
  attemptNumber: number;
  retriesConsumed: number;
  signal?: AbortSignal;
};
type ClientRetryOptions = {
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
  factor?: number;
  signal?: AbortSignal;
  shouldRetry: (error: Error, context: ClientRetryContext) => boolean;
};
/** Browser-safe bounded exponential retry with full jitter and AbortSignal support. */
export async function retryClientOperation<T>(
  operation: (context: ClientRetryContext) => Promise<T>,
  options: ClientRetryOptions,
): Promise<T> {
  const retries = Number.isFinite(options.retries)
    ? Math.min(20, Math.max(0, Math.trunc(options.retries)))
    : 0;
  const minDelayMs = Number.isFinite(options.minDelayMs)
    ? Math.min(300_000, Math.max(0, options.minDelayMs))
    : 0;
  const maxDelayMs = Number.isFinite(options.maxDelayMs)
    ? Math.min(300_000, Math.max(minDelayMs, options.maxDelayMs))
    : minDelayMs;
  const requestedFactor = options.factor ?? 2;
  const factor = Number.isFinite(requestedFactor)
    ? Math.min(10, Math.max(1, requestedFactor))
    : 2;
  for (let retriesConsumed = 0; ; retriesConsumed += 1) {
    throwIfAborted(options.signal);
    const context: ClientRetryContext = {
      attemptNumber: retriesConsumed + 1,
      retriesConsumed,
      signal: options.signal,
    };
    try {
      return await operation(context);
    } catch (error) {
      throwIfAborted(options.signal);
      const normalized = error instanceof Error
        ? error
        : new TypeError(`Non-error thrown during retry: ${String(error)}`);
      if (
        retriesConsumed >= retries ||
        !options.shouldRetry(normalized, context)
      ) {
        throw normalized;
      }
      const ceiling = Math.min(
        maxDelayMs,
        minDelayMs * factor ** retriesConsumed,
      );
      // Full jitter avoids synchronizing clients after a shared outage.
      const delayMs = Math.floor(Math.random() * Math.max(1, ceiling));
      await abortableDelay(delayMs, options.signal);
    }
  }
}
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}
