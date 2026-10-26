/** Throw the original cancellation reason at bounded stage boundaries. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(reason == null ? "Operation aborted" : String(reason));
}

/** Combine caller cancellation with a local timeout without leaking timers. */
export function deadlineSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const bounded = Math.max(1, Math.trunc(timeoutMs));
  const timeout = AbortSignal.timeout(bounded);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}
