import { isTransactionRetryableDatabaseError } from "./database-errors.js";
import { setTimeout as delay } from "node:timers/promises";
export const isSerializableRetryError = isTransactionRetryableDatabaseError;
/**
 * Retry an idempotent database-only unit on transient concurrency failures.
 * Never include network I/O or other non-idempotent side effects in operation.
 */
export async function withDatabaseConcurrencyRetry<T>(
  operation: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  const limit = Math.max(1, Math.min(10, Math.trunc(attempts)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSerializableRetryError(error) || attempt === limit) throw error;
      const ceilingMs = Math.min(1_000, 25 * 2 ** (attempt - 1));
      await delay(Math.floor(Math.random() * (ceilingMs + 1)));
    }
  }
  throw lastError;
}

/** Retry the entire database-only serializable transaction. Never put network I/O in operation. */
export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  return withDatabaseConcurrencyRetry(operation, attempts);
}
