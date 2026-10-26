/** Persisted on AgentMetadata; preserved across chain sync (see agent-chain-sync-merge). */
export const ADMIN_LAYER_PROFILE_KEY = "admin_layer_profile";
export const ADMIN_LAYER_PROTOCOL_TRUST_KEY = "admin_layer_protocol_trust";
export const ADMIN_LAYER_REPUTATION_KEY = "admin_layer_reputation";
export const ADMIN_LAYER_ACTIVITY_KEY = "admin_layer_activity";
export type AdminScoringLayerKey = "profile" | "protocolTrust" | "reputation" | "activity";
const KEY_BY_LAYER: Record<AdminScoringLayerKey, string> = {
  profile: ADMIN_LAYER_PROFILE_KEY,
  protocolTrust: ADMIN_LAYER_PROTOCOL_TRUST_KEY,
  reputation: ADMIN_LAYER_REPUTATION_KEY,
  activity: ADMIN_LAYER_ACTIVITY_KEY,
};
export const ADMIN_SCORING_LAYER_KEYS: readonly AdminScoringLayerKey[] = [
  "profile",
  "protocolTrust",
  "reputation",
  "activity",
] as const;
export const SCORING_LAYER_WEIGHT_LABELS: Record<AdminScoringLayerKey, string> = {
  profile: "30%",
  protocolTrust: "30%",
  reputation: "25%",
  activity: "15%",
};
export const SCORING_LAYER_LABELS: Record<AdminScoringLayerKey, string> = {
  profile: "Profile quality",
  protocolTrust: "Protocol trust",
  reputation: "Reputation",
  activity: "Activity",
};
function clampDim(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function parseStoredDim(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return clampDim(n);
}
export function parseAdminScoringLayerOverrides(
  metadata: Array<{ key: string; value: string }> | null | undefined,
): Partial<Record<AdminScoringLayerKey, number>> {
  if (!metadata?.length) return {};
  const lowerToValue = new Map<string, string>();
  for (const m of metadata) {
    lowerToValue.set(m.key.trim().toLowerCase(), m.value);
  }
  const out: Partial<Record<AdminScoringLayerKey, number>> = {};
  for (const layer of ADMIN_SCORING_LAYER_KEYS) {
    const v = parseStoredDim(lowerToValue.get(KEY_BY_LAYER[layer].toLowerCase()));
    if (v !== undefined) out[layer] = v;
  }
  return out;
}
export function adminScoringLayerMetaKey(layer: AdminScoringLayerKey): string {
  return KEY_BY_LAYER[layer];
}