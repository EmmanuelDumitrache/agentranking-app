/**
 * TanStack Query retry policy for `/api/agents`.
 * Retries only bounded connection-pool acquisition pressure. Query execution
 * timeouts are not replayed because doing so can amplify an already expensive read.
 */
export function shouldRetryAgentsListQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  const transientDatabasePressure =
    /DB_POOL_TIMEOUT|DB_MAX_CONNECTIONS|Database connection pool is busy/i.test(
      message,
    );
  return transientDatabasePressure && failureCount < 2;
}

export function agentsListRetryDelay(failureCount: number, error: unknown): number {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  if (
    /DB_POOL_TIMEOUT|DB_MAX_CONNECTIONS|Database connection pool is busy/i.test(
      message,
    )
  ) {
    return Math.min(25_000, 6_000 + failureCount * 5_000);
  }
  return 0;
}
