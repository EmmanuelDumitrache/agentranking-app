/** Persisted on AgentMetadata; preserved across chain sync (see agent-chain-sync-merge). */
export const ADMIN_TRUST_DIM_METADATA_KEY = "admin_trust_dim_metadata";
export const ADMIN_TRUST_DIM_ENDPOINTS_KEY = "admin_trust_dim_endpoints";
export const ADMIN_TRUST_DIM_SOCIAL_KEY = "admin_trust_dim_social";
export const ADMIN_TRUST_DIM_COMPLIANCE_KEY = "admin_trust_dim_compliance";
export const ADMIN_TRUST_DIM_QUALITY_KEY = "admin_trust_dim_quality";
export const ADMIN_TRUST_DIM_POPULARITY_KEY = "admin_trust_dim_popularity";
export const ADMIN_TRUST_DIM_FRESHNESS_KEY = "admin_trust_dim_freshness";
export const ADMIN_TRUST_DIM_VERIFIED_REVENUE_KEY = "admin_trust_dim_verified_revenue";
export const COVENANT_VERIFICATION_SNAPSHOT_METADATA_KEY = "covenant_verification_snapshot";
export const COVENANT_DETECTED_AT_METADATA_KEY = "covenant_detected_at";
export const INTERNAL_AGENT_METADATA_KEYS_LOWER = new Set([
  COVENANT_VERIFICATION_SNAPSHOT_METADATA_KEY,
  COVENANT_DETECTED_AT_METADATA_KEY,
  "admin_agent_rank_score_lock",
  "admin_layer_profile",
  "admin_layer_protocol_trust",
  "admin_layer_reputation",
  "admin_layer_activity",
  ADMIN_TRUST_DIM_METADATA_KEY,
  ADMIN_TRUST_DIM_ENDPOINTS_KEY,
  ADMIN_TRUST_DIM_SOCIAL_KEY,
  ADMIN_TRUST_DIM_COMPLIANCE_KEY,
  ADMIN_TRUST_DIM_QUALITY_KEY,
  ADMIN_TRUST_DIM_POPULARITY_KEY,
  ADMIN_TRUST_DIM_FRESHNESS_KEY,
  ADMIN_TRUST_DIM_VERIFIED_REVENUE_KEY,
]);
/** Keys aligned with `TrustDimensionValues` / `AGENT_SCORE_WEIGHTS` (eight weighted rows). */
export type AdminTrustDimensionKey =
  | "metadata"
  | "endpoints"
  | "social"
  | "compliance"
  | "quality"
  | "popularity"
  | "freshness"
  | "verifiedRevenue";
const KEY_BY_DIM: Record<AdminTrustDimensionKey, string> = {
  metadata: ADMIN_TRUST_DIM_METADATA_KEY,
  endpoints: ADMIN_TRUST_DIM_ENDPOINTS_KEY,
  social: ADMIN_TRUST_DIM_SOCIAL_KEY,
  compliance: ADMIN_TRUST_DIM_COMPLIANCE_KEY,
  quality: ADMIN_TRUST_DIM_QUALITY_KEY,
  popularity: ADMIN_TRUST_DIM_POPULARITY_KEY,
  freshness: ADMIN_TRUST_DIM_FRESHNESS_KEY,
  verifiedRevenue: ADMIN_TRUST_DIM_VERIFIED_REVENUE_KEY,
};
export const ADMIN_TRUST_DIMENSION_KEYS: readonly AdminTrustDimensionKey[] = [
  "metadata",
  "endpoints",
  "social",
  "compliance",
  "quality",
  "popularity",
  "freshness",
  "verifiedRevenue",
] as const;
function clampDim(n: number): number {
  return Math.max(0, Math.min(100, n));
}
function parseStoredDim(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return clampDim(n);
}
/** Read numeric overrides from agent metadata rows. */
export function parseAdminTrustDimensionOverrides(
  metadata: Array<{ key: string; value: string }> | null | undefined,
): Partial<Record<AdminTrustDimensionKey, number>> {
  if (!metadata?.length) return {};
  const lowerToValue = new Map<string, string>();
  for (const m of metadata) {
    lowerToValue.set(m.key.trim().toLowerCase(), m.value);
  }
  const out: Partial<Record<AdminTrustDimensionKey, number>> = {};
  for (const d of ADMIN_TRUST_DIMENSION_KEYS) {
    const v = parseStoredDim(lowerToValue.get(KEY_BY_DIM[d].toLowerCase()));
    if (v !== undefined) out[d] = v;
  }
  return out;
}
type EightTrustDims = {
  metadata: number;
  endpoints: number;
  social: number;
  compliance: number;
  quality: number;
  popularity: number;
  freshness: number;
  verifiedRevenue: number;
};
/** Apply parsed overrides onto a base trust breakdown (0–100 dimensions). */
export function applyParsedTrustDimensionOverrides<T extends EightTrustDims & Record<string, number>>(
  dims: T,
  overrides: Partial<Record<AdminTrustDimensionKey, number>>,
): T {
  if (!overrides || Object.keys(overrides).length === 0) return dims;
  return {
    ...dims,
    metadata:
      overrides.metadata !== undefined ? clampDim(overrides.metadata) : dims.metadata,
    endpoints:
      overrides.endpoints !== undefined ? clampDim(overrides.endpoints) : dims.endpoints,
    social: overrides.social !== undefined ? clampDim(overrides.social) : dims.social,
    compliance:
      overrides.compliance !== undefined ? clampDim(overrides.compliance) : dims.compliance,
    quality: overrides.quality !== undefined ? clampDim(overrides.quality) : dims.quality,
    popularity:
      overrides.popularity !== undefined ? clampDim(overrides.popularity) : dims.popularity,
    freshness:
      overrides.freshness !== undefined ? clampDim(overrides.freshness) : dims.freshness,
    verifiedRevenue:
      overrides.verifiedRevenue !== undefined
        ? clampDim(overrides.verifiedRevenue)
        : dims.verifiedRevenue,
  };
}
export function adminTrustDimensionMetaKey(dim: AdminTrustDimensionKey): string {
  return KEY_BY_DIM[dim];
}
export function stripInternalAgentMetadata<T extends { key: string; value: string }>(
  metadata: readonly T[],
): T[] {
  return metadata.filter((m) => !INTERNAL_AGENT_METADATA_KEYS_LOWER.has(m.key.trim().toLowerCase()));
}
