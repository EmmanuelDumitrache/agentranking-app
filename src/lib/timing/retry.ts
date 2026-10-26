import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import pRetry, { AbortError } from "p-retry";
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}
export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : null;
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - nowMs);
}
const MAX_RETRIES = 20;
const MAX_RETRY_DELAY_MS = 300_000;

export async function retryHttpOperation<T>(
  operation: () => Promise<T>,
  options: { retries?: number; signal?: AbortSignal; minTimeout?: number; maxTimeout?: number } = {},
): Promise<T> {
  const retries = Number.isFinite(options.retries)
    ? Math.min(MAX_RETRIES, Math.max(0, Math.trunc(options.retries!)))
    : 2;
  const minTimeout = Number.isFinite(options.minTimeout)
    ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Math.trunc(options.minTimeout!)))
    : 500;
  const maxTimeout = Number.isFinite(options.maxTimeout)
    ? Math.min(
        MAX_RETRY_DELAY_MS,
        Math.max(minTimeout, Math.trunc(options.maxTimeout!)),
      )
    : Math.max(minTimeout, 8_000);
  return pRetry(operation, {
    retries,
    factor: 2,
    minTimeout,
    maxTimeout,
    randomize: true,
    signal: options.signal,
    unref: true,
    shouldRetry: ({ error }) => {
      if (error instanceof HttpStatusError) {
        return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
      }
      return !(error instanceof AbortError);
    },
    onFailedAttempt: async ({ error }) => {
      if (error instanceof HttpStatusError && error.retryAfterMs && error.retryAfterMs > 0) {
        await delay(Math.min(error.retryAfterMs, 30_000), undefined, {
          signal: options.signal,
          ref: false,
        });
      }
    },
  });
}
