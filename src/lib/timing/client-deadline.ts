/**
 * Bounds how long a caller waits for a browser API that does not accept an
 * AbortSignal. The underlying operation is intentionally not claimed to be
 * cancelled; late completion is allowed to converge external adapter state.
 */
const MAX_TIMER_MS = 2_147_483_647;

export function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const boundedTimeoutMs = Number.isFinite(timeoutMs)
      ? Math.min(MAX_TIMER_MS, Math.max(1, Math.trunc(timeoutMs)))
      : 1;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(timeoutError());
    }, boundedTimeoutMs);
    void operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
