const CONTROL_AND_FORMAT = /[\p{Cc}\p{Cf}]/gu;
const NON_SEMANTIC = /[^\p{L}\p{Nd}]+/gu;

/**
 * Candidate-matching key for Agent names. It is deliberately not a URL slug
 * and must never be used as a durable identity or as the sole merge signal.
 */
export function normalizeAgentNameKey(name: string): string | null {
  const key = String(name)
    .normalize("NFKC")
    .replace(CONTROL_AND_FORMAT, "")
    .toLowerCase()
    .replace(NON_SEMANTIC, "");
  return key.length > 0 ? key : null;
}
