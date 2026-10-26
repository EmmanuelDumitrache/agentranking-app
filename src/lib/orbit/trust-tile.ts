import {
  ORBIT_LAUNCH_BADGE_LABEL,
  ORBIT_LAUNCH_BADGE_TITLE,
  ORBIT_LAUNCH_ID_METADATA_KEY,
  ORBIT_LAUNCHED_AT_METADATA_KEY,
  ORBIT_SOURCE_METADATA_KEY,
  ORBIT_SOURCE_TYPE_METADATA_KEY,
  ORBIT_URL_METADATA_KEY,
} from "@/lib/orbit/config";
import type { TrustSummaryTile } from "@/lib/signals/types";
export type MetadataEntry = { readonly key: string; readonly value: string };
export const ORBIT_LAUNCH_TRUST_TILE_KEY = "orbit_launch";
function metadataValue(metadata: readonly MetadataEntry[], key: string): string {
  return metadata.find((entry) => entry.key === key)?.value?.trim() ?? "";
}
export type OrbitLaunchAgentState = {
  orbitLaunchId: string;
  orbitUrl?: string;
  launchedAt?: string;
  source: string;
  sourceType: string;
};
export function parseOrbitLaunchFromMetadata(
  metadata: readonly MetadataEntry[],
): OrbitLaunchAgentState | null {
  const orbitLaunchId = metadataValue(metadata, ORBIT_LAUNCH_ID_METADATA_KEY);
  if (!orbitLaunchId) return null;
  const source = metadataValue(metadata, ORBIT_SOURCE_METADATA_KEY) || "orbit";
  const sourceType = metadataValue(metadata, ORBIT_SOURCE_TYPE_METADATA_KEY) || "partner_launch";
  const orbitUrl = metadataValue(metadata, ORBIT_URL_METADATA_KEY) || undefined;
  const launchedAt = metadataValue(metadata, ORBIT_LAUNCHED_AT_METADATA_KEY) || undefined;
  return {
    orbitLaunchId,
    source,
    sourceType,
    ...(orbitUrl ? { orbitUrl } : {}),
    ...(launchedAt ? { launchedAt } : {}),
  };
}
export function buildOrbitLaunchTrustTile(metadata: readonly MetadataEntry[]): TrustSummaryTile {
  const parsed = parseOrbitLaunchFromMetadata(metadata);
  if (!parsed) {
    return {
      key: ORBIT_LAUNCH_TRUST_TILE_KEY,
      label: "ORBIT LAUNCH",
      value: "Not launched via Orbit",
      status: "unknown",
      title: "No Orbit partner launch provenance on this profile.",
    };
  }
  return {
    key: ORBIT_LAUNCH_TRUST_TILE_KEY,
    label: "ORBIT LAUNCH",
    value: ORBIT_LAUNCH_BADGE_LABEL,
    status: "partner_registered",
    statusLabel: parsed.launchedAt ? `Launched ${parsed.launchedAt.slice(0, 10)}` : "Partner launch",
    title: ORBIT_LAUNCH_BADGE_TITLE,
  };
}
export function appendOrbitLaunchTrustTile(
  tiles: readonly TrustSummaryTile[],
  metadata: readonly MetadataEntry[],
): TrustSummaryTile[] {
  const without = tiles.filter((tile) => tile.key !== ORBIT_LAUNCH_TRUST_TILE_KEY);
  return [...without, buildOrbitLaunchTrustTile(metadata)];
}