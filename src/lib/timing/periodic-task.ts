import { setTimeout as delay } from "node:timers/promises";

const MAX_TIMER_MS = 2_147_483_647;

export type PeriodicTaskOptions = {
  signal: AbortSignal;
  intervalMs: number;
  runImmediately?: boolean;
  jitterMs?: number;
  /** Keep the process alive while waiting. Background daemons should normally leave this false. */
  ref?: boolean;
  task: (signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void;
};

function boundedDelayMs(intervalMs: number, jitterMs: number): number {
  if (!Number.isFinite(intervalMs)) {
    throw new RangeError("Periodic task interval must be finite");
  }
  const interval = Math.min(MAX_TIMER_MS, Math.max(1, Math.trunc(intervalMs)));
  const requestedJitter = Number.isFinite(jitterMs)
    ? Math.max(0, Math.trunc(jitterMs))
    : 0;
  const jitter = Math.min(requestedJitter, MAX_TIMER_MS - interval);
  if (jitter === 0) return interval;
  return interval + Math.floor(Math.random() * (jitter + 1));
}

/**
 * Runs one asynchronous task at a time and waits after each completion.
 * Unlike setInterval, a slow iteration cannot overlap the next iteration.
 * The unref'd delay does not keep a Node.js process alive during shutdown.
 */
export async function runPeriodicTask({
  signal,
  intervalMs,
  runImmediately = false,
  jitterMs = 0,
  ref = false,
  task,
  onError,
}: PeriodicTaskOptions): Promise<void> {
  let shouldDelay = !runImmediately;
  while (!signal.aborted) {
    if (shouldDelay) {
      try {
        await delay(boundedDelayMs(intervalMs, jitterMs), undefined, {
          signal,
          ref,
        });
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
    }
    shouldDelay = true;
    if (signal.aborted) return;
    try {
      await task(signal);
    } catch (error) {
      if (signal.aborted) return;
      if (!onError) throw error;
      onError(error);
    }
  }
}
