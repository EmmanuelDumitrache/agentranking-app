/**
 * When the indexer applies on-chain registration metadata/services, preserve rows the chain
 * omitted so admin boosts (social + extra endpoints) survive until the chain sends those keys.
 */
export const CHAIN_SYNC_PRESERVE_METADATA_KEYS_LOWER = new Set([
  "twitter",
  "x",
  "website",
  "uri",
  "url",
  "github",
  "discord",
  "telegram",
  "admin_agent_rank_score_lock",
  "admin_trust_dim_metadata",
  "admin_trust_dim_endpoints",
  "admin_trust_dim_social",
  "admin_trust_dim_compliance",
  "admin_trust_dim_quality",
  "admin_trust_dim_popularity",
  "admin_trust_dim_freshness",
  "admin_trust_dim_verified_revenue",
  "admin_layer_profile",
  "admin_layer_protocol_trust",
  "admin_layer_reputation",
  "admin_layer_activity",
  "medusapassportsupported",
  "medusapassportusecase",
  "medusamintier",
  "medusapassportwalletverified",
  "medusapassportverifiedtier",
  "medusapassportclaimwallet",
  "medusapassportverifiedat",
  "medusapassportnullifier",
]);
export type ChainSyncMetaEntry = { key: string; value: string };
export type ChainSyncServiceEntry = { name: string; endpoint: string; version: string };
/** Chain metadata plus preserved admin-only social keys not present in the incoming payload. */
export function mergeMetadataEntriesForChainSync(
  existing: readonly ChainSyncMetaEntry[],
  incoming: readonly ChainSyncMetaEntry[],
): ChainSyncMetaEntry[] {
  const incomingKeysLower = new Set<string>();
  const merged = [...incoming];
  for (const entry of incoming) incomingKeysLower.add(entry.key.toLowerCase());
  for (const entry of existing) {
    const key = entry.key.toLowerCase();
    if (CHAIN_SYNC_PRESERVE_METADATA_KEYS_LOWER.has(key) && !incomingKeysLower.has(key)) {
      merged.push(entry);
    }
  }
  return merged;
}
/** Incoming services win by name (uppercase); keep existing rows whose names are absent on-chain. */
export function mergeServicesForChainSync(
  existing: readonly ChainSyncServiceEntry[],
  incoming: readonly { name: string; endpoint: string; version?: string }[],
): ChainSyncServiceEntry[] {
  const incomingNames = new Set<string>();
  const merged: ChainSyncServiceEntry[] = [];
  for (const service of incoming) {
    incomingNames.add(service.name.toUpperCase());
    merged.push({ name: service.name, endpoint: service.endpoint, version: service.version ?? "" });
  }
  for (const service of existing) {
    if (!incomingNames.has(service.name.toUpperCase())) merged.push(service);
  }
  return merged;
}
