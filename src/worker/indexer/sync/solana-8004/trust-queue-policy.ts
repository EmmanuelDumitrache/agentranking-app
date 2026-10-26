export const SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS = 2 * 60_000;
export const SOLANA_8004_TRUST_STALE_RUNNING_MS = 20 * 60_000;
// The pg-boss trust queue retains created/retry jobs for 30 days. Only reclaim a
// QUEUED reservation after that durable execution record could itself have aged out.
export const SOLANA_8004_TRUST_STALE_QUEUE_RESERVATION_MS = 31 * 24 * 60 * 60_000;
export const SOLANA_8004_TRUST_MAX_QUEUE_DEPTH = 1_000;

export function solana8004TrustQueueTargetDepth(batchSize: number): number {
  const normalizedBatchSize = Number.isFinite(batchSize) ? Math.max(1, Math.trunc(batchSize)) : 1;
  return Math.min(SOLANA_8004_TRUST_MAX_QUEUE_DEPTH, normalizedBatchSize * 4);
}

export class Solana8004TrustRetryDeferredError extends Error {
  readonly retryAt: Date;

  constructor(signature: string, retryAt: Date) {
    super(`Solana 8004 trust signature ${signature} is cooling down until ${retryAt.toISOString()}`);
    this.name = "Solana8004TrustRetryDeferredError";
    this.retryAt = retryAt;
  }
}

export function solana8004TrustFailedRetryAt(updatedAt: Date): Date {
  return new Date(updatedAt.getTime() + SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS);
}
