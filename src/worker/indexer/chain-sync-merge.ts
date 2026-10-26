/**
 * Mirror of src/lib/agent-chain-sync-merge.ts — keep behavior in sync when editing merge rules.
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
