const MAX_TIMEOUT_MS = 2_147_483_647;

export function timeoutSignal(timeoutMs: number, parentSignal?: AbortSignal): AbortSignal {
  const boundedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.trunc(timeoutMs)))
    : 1;
  const timeout = AbortSignal.timeout(boundedTimeoutMs);
  return parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
}
export function isAbortLike(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
