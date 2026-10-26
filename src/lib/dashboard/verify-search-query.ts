/** Client-safe query normalization for verify wizard search (no server imports). */
export function normalizeVerifySearchQuery(raw: string): string {
  return raw.trim().replace(/\\+$/g, "").trim();
}
