import { HATCHER_CHAIN_ID } from "@/lib/chain-constants";
export { HATCHER_CHAIN_ID };
export const HATCHER_METADATA_KEY = "hatcher";
export const HATCHER_ID_METADATA_KEY = "hatcher_id";
export const HATCHER_SYNC_RUN_KEY = "hatcher_sync_run";
export const HATCHER_PROJECTION_DIGEST_KEY = "hatcher_projection_digest";
export const HATCHER_LISTING_REGISTRY_SOURCE = "hatcher";
export const HATCHER_PARTNER_SOURCE_LABEL = "Partner source";
export const HATCHER_INDEXED_BADGE_LABEL = "Hatcher Indexed";
export const HATCHER_VERIFIED_BADGE_LABEL = "Hatcher Verified";
export const HATCHER_DISCOVERY_SCORE_LABEL = "Hatcher discovery score";
export const HATCHER_INDEXED_BY_AR_LABEL = "Indexed by AgentRanking";
/** Short disclaimer for hub footer and hero footnotes. */
export const HATCHER_INDEXED_SHORT_DISCLAIMER =
  "Hatcher Indexed means the agent appears in Hatcher's public opt-in feed. It is not KYA verification.";
export function resolveHatcherApiBaseUrl(): string {
  const raw = process.env.HATCHER_API_BASE_URL?.trim();
  return (raw || "https://api.hatcher.host").replace(/\/$/, "");
}
export function resolveHatcherSyncLimit(): number {
  const raw = process.env.HATCHER_SYNC_LIMIT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 60;
  if (!Number.isFinite(n) || n < 1) return 60;
  return Math.min(500, n);
}
export function resolveHatcherSyncConcurrency(): number {
  const raw = process.env.HATCHER_SYNC_CONCURRENCY?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 3;
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(12, n);
}
export function resolveHatcherAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.HATCHER_API_KEY?.trim();
  const headerName = process.env.HATCHER_API_AUTH_HEADER?.trim();
  if (key && headerName) {
    headers[headerName] = key;
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}
