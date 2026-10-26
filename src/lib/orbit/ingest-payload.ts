import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { sanitizeForPostgres } from "@/lib/utils";
import {
  ORBIT_CAPABILITIES_METADATA_KEY,
  ORBIT_LAUNCH_ID_METADATA_KEY,
  ORBIT_LAUNCHED_AT_METADATA_KEY,
  ORBIT_LISTING_REGISTRY_SOURCE,
  ORBIT_METAPLEX_ASSET_METADATA_KEY,
  ORBIT_RAW_PAYLOAD_METADATA_KEY,
  ORBIT_SOURCE_METADATA_KEY,
  ORBIT_SOURCE_TYPE_METADATA_KEY,
  ORBIT_TAGS_METADATA_KEY,
  ORBIT_URL_METADATA_KEY,
} from "@/lib/orbit/config";
import type { OrbitAgentIngestPayload, NormalizedOrbitIngestPayload } from "@/lib/orbit/types";
type MetadataEntry = { key: string; value: string };
export function metadataEntriesFromPayload(payload: NormalizedOrbitIngestPayload): MetadataEntry[] {
  const entries: MetadataEntry[] = [
    { key: "source", value: ORBIT_LISTING_REGISTRY_SOURCE },
    { key: ORBIT_LAUNCH_ID_METADATA_KEY, value: payload.orbitLaunchId },
    { key: ORBIT_SOURCE_METADATA_KEY, value: ORBIT_LISTING_REGISTRY_SOURCE },
    { key: ORBIT_SOURCE_TYPE_METADATA_KEY, value: "partner_launch" },
  ];
  if (payload.launchedAt) {
    entries.push({ key: ORBIT_LAUNCHED_AT_METADATA_KEY, value: payload.launchedAt });
  }
  if (payload.orbitUrl) {
    entries.push({ key: ORBIT_URL_METADATA_KEY, value: payload.orbitUrl });
  }
  if (payload.websiteUrl) {
    entries.push({ key: "website", value: payload.websiteUrl });
  }
  if (payload.xUrl) {
    entries.push({ key: "twitter", value: payload.xUrl });
  }
  if (payload.telegramUrl) {
    entries.push({ key: "telegram", value: payload.telegramUrl });
  }
  if (payload.githubUrl) {
    entries.push({ key: "github", value: payload.githubUrl });
  }
  if (payload.metaplexAssetId) {
    entries.push({ key: ORBIT_METAPLEX_ASSET_METADATA_KEY, value: payload.metaplexAssetId });
  }
  if (payload.capabilities.length > 0) {
    entries.push({
      key: ORBIT_CAPABILITIES_METADATA_KEY,
      value: JSON.stringify(payload.capabilities),
    });
  }
  if (payload.tags.length > 0) {
    entries.push({ key: ORBIT_TAGS_METADATA_KEY, value: JSON.stringify(payload.tags) });
  }
  entries.push({
    key: ORBIT_RAW_PAYLOAD_METADATA_KEY,
    value: JSON.stringify(payload.rawPayload).slice(0, 48000),
  });
  return entries;
}
function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trim(item)).filter(Boolean);
}
function parseLaunchedAt(value: string): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString();
}
export function normalizeOrbitChain(chain: unknown): number | null {
  const normalized = trim(chain).toLowerCase();
  if (normalized === "solana") return SOLANA_CHAIN_ID;
  return null;
}
export function normalizeOrbitIngestPayload(
  body: OrbitAgentIngestPayload,
): { ok: true; payload: NormalizedOrbitIngestPayload } | { ok: false; error: string } {
  const orbitLaunchId = trim(body.orbitLaunchId);
  const name = trim(body.name);
  const chainId = normalizeOrbitChain(body.chain);
  if (!orbitLaunchId) return { ok: false, error: "orbitLaunchId is required." };
  if (!name) return { ok: false, error: "name is required." };
  if (chainId == null) return { ok: false, error: "chain must be solana for the current ingestion endpoint." };
  const tokenMint = trim(body.tokenMint);
  const creatorWallet = trim(body.creatorWallet);
  const agentWallet = trim(body.agentWallet);
  const owner = creatorWallet || agentWallet;
  const rawPayload: Record<string, unknown> = {
    orbitLaunchId,
    name,
    description: trim(body.description),
    tokenMint: tokenMint || undefined,
    chain: "solana",
    creatorWallet: creatorWallet || undefined,
    agentWallet: agentWallet || undefined,
    metaplexAssetId: trim(body.metaplexAssetId) || undefined,
    imageUrl: trim(body.imageUrl) || undefined,
    websiteUrl: trim(body.websiteUrl) || undefined,
    xUrl: trim(body.xUrl) || undefined,
    telegramUrl: trim(body.telegramUrl) || undefined,
    githubUrl: trim(body.githubUrl) || undefined,
    orbitUrl: trim(body.orbitUrl) || undefined,
    launchedAt: trim(body.launchedAt) || undefined,
    capabilities: stringArray(body.capabilities),
    tags: stringArray(body.tags),
  };
  return {
    ok: true,
    payload: {
      orbitLaunchId: sanitizeForPostgres(orbitLaunchId.slice(0, 120)),
      name: sanitizeForPostgres(name.slice(0, 80)),
      description: sanitizeForPostgres(trim(body.description).slice(0, 2000)),
      tokenMint: sanitizeForPostgres(tokenMint.slice(0, 120)),
      chainId,
      owner: sanitizeForPostgres(owner.slice(0, 120)),
      metaplexAssetId: sanitizeForPostgres(trim(body.metaplexAssetId).slice(0, 120)),
      imageUrl: sanitizeForPostgres(trim(body.imageUrl).slice(0, 2000)),
      websiteUrl: sanitizeForPostgres(trim(body.websiteUrl).slice(0, 2000)),
      xUrl: sanitizeForPostgres(trim(body.xUrl).slice(0, 2000)),
      telegramUrl: sanitizeForPostgres(trim(body.telegramUrl).slice(0, 2000)),
      githubUrl: sanitizeForPostgres(trim(body.githubUrl).slice(0, 2000)),
      orbitUrl: sanitizeForPostgres(trim(body.orbitUrl).slice(0, 2000)),
      launchedAt: parseLaunchedAt(trim(body.launchedAt)),
      capabilities: stringArray(body.capabilities).map((item) => sanitizeForPostgres(item.slice(0, 80))),
      tags: stringArray(body.tags).map((item) => sanitizeForPostgres(item.slice(0, 80))),
      rawPayload,
    },
  };
}
