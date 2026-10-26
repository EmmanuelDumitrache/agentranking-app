/** Detect Next.js lazy-chunk load failures caused by stale HTML after deploy. */
export function isChunkLoadErrorMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /Loading chunk \d+ failed/i.test(m) ||
    /ChunkLoadError/i.test(m) ||
    /Failed to fetch dynamically imported module/i.test(m) ||
    /Importing a module script failed/i.test(m) ||
    /Unexpected token/i.test(m) ||
    /Unexpected identifier/i.test(m) ||
    /Invalid or unexpected token/i.test(m)
  );
}
export const CHUNK_RELOAD_SESSION_KEY = "ar-chunk-reload-attempt";
export function shouldAttemptChunkReload(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY) !== "1";
}
export function markChunkReloadAttempt(): void {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, "1");
  } catch {
    /* private mode / quota */
  }
}
export function clearChunkReloadAttempt(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
export function reloadForChunkError(): void {
  markChunkReloadAttempt();
  globalThis.location.reload();
}
