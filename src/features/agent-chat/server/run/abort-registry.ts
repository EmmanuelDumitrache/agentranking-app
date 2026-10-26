/**
 * In-memory abort registry with TTL cleanup.
 *
 * Each chat run registers its AbortController on start and unregisters on
 * completion/failure/cancellation. Client-side stop() calls route through
 * requestAbort(), which signals the controller so the provider stream can
 * terminate without leaking.
 *
 * A 5-minute TTL prevents memory leaks when a run crashes without unregistering.
 */
const store = new Map<string, { controller: AbortController; registeredAt: number }>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_REGISTERED_RUNS = 2_048;
function reapExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [runId, entry] of store) {
    if (entry.registeredAt < cutoff) {
      try {
        entry.controller.abort("registry-ttl-expired");
      } catch {
        // ignore
      }
      store.delete(runId);
    }
  }
}
/** Register an AbortController for the given run. */
export function register(runId: string, controller: AbortController): void {
  reapExpired();
  const previous = store.get(runId);
  if (previous && previous.controller !== controller) {
    previous.controller.abort("registry-registration-replaced");
  }
  store.delete(runId);
  store.set(runId, { controller, registeredAt: Date.now() });
  while (store.size > MAX_REGISTERED_RUNS) {
    const oldestRunId = store.keys().next().value as string | undefined;
    if (oldestRunId === undefined) break;
    const oldest = store.get(oldestRunId);
    oldest?.controller.abort("registry-capacity-evicted");
    store.delete(oldestRunId);
  }
}
/**
 * Abort the registered controller (if any).
 * Returns true if a controller was found and aborted.
 */
export function requestAbort(runId: string): boolean {
  reapExpired();
  const entry = store.get(runId);
  if (!entry) return false;
  entry.controller.abort();
  store.delete(runId);
  return true;
}
/** Remove the registration for a completed/failed/cancelled run. */
export function unregister(runId: string): void {
  store.delete(runId);
}
