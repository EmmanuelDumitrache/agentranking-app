/**
 * Domain-row leases must outlive pg-boss job expiry. This prevents a second
 * worker from reclaiming an operation while the original job can still be
 * active. Failed pg-boss attempts retry until the lease becomes stale.
 */
export const DOMAIN_DELIVERY_STALE_MS = 35 * 60 * 1_000;
export const GITHUB_PROCESSING_STALE_MS = 61 * 60 * 1_000;

export function staleBefore(staleMs: number, now = Date.now()): Date {
  return new Date(now - staleMs);
}
