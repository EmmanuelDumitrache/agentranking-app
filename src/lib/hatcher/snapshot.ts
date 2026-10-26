import {
  HATCHER_CHAIN_ID,
  HATCHER_ID_METADATA_KEY,
  HATCHER_LISTING_REGISTRY_SOURCE,
  HATCHER_METADATA_KEY,
} from "@/lib/hatcher/config";
import { buildHatcherLinks, hatcherPublicId, hatcherTruncateWallet } from "@/lib/hatcher/links";
import { computeHatcherPartnerScore } from "@/lib/hatcher/score";
import type {
  HatcherDetailPayload,
  HatcherExploreAgent,
  HatcherMetadataBadge,
  HatcherMetadataSource,
  HatcherMetadata,
} from "@/lib/hatcher/types";
type StoredHatcherMetadata = Record<string, unknown>;
function normalizeStoredHatcherMetadata(parsed: StoredHatcherMetadata): HatcherMetadata | null {
  const hatcherId = String(parsed.hatcherId ?? "").trim();
  if (!hatcherId) return null;
  const slug = String(parsed.slug ?? "").trim();
  const publicId = String(parsed.publicId ?? "").trim() || hatcherPublicId({ id: hatcherId, slug });
  const rawSource = String(parsed.source ?? "");
  const source: HatcherMetadataSource = rawSource === "partner_feed" ? "partner_feed" : "explore";
  const badge: HatcherMetadataBadge = parsed.badge === "verified" ? "verified" : "indexed";
  const linksRaw = parsed.links as HatcherMetadata["links"] | undefined;
  const links = linksRaw?.profile && linksRaw.passport
    ? linksRaw
    : buildHatcherLinks(publicId, hatcherId);
  const ownerRaw = (parsed.owner ?? {}) as { username?: string; walletAddressTruncated?: string };
  return {
    version: 1,
    hatcherId,
    slug,
    publicId,
    framework: String(parsed.framework ?? ""),
    template: String(parsed.template ?? ""),
    status: String(parsed.status ?? "unknown").toLowerCase(),
    messageCount: Number(parsed.messageCount ?? 0),
    publicChatEnabled: parsed.publicChatEnabled === true,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
    owner: {
      username: ownerRaw.username?.trim() || undefined,
      walletAddressTruncated: ownerRaw.walletAddressTruncated?.trim() || undefined,
    },
    source,
    badge,
    links,
    passportSnapshot: parsed.passportSnapshot ?? null,
    mcpManifestSnapshot: parsed.mcpManifestSnapshot ?? null,
    publicStatsSnapshot: parsed.publicStatsSnapshot ?? null,
    lastIndexedAt: typeof parsed.lastIndexedAt === "string" ? parsed.lastIndexedAt : new Date().toISOString(),
    lastDetailFetchAt: typeof parsed.lastDetailFetchAt === "string" ? parsed.lastDetailFetchAt : null,
    partnerScore: typeof parsed.partnerScore === "number" ? parsed.partnerScore : undefined,
    partnerScoreBreakdown:
      (parsed.partnerScoreBreakdown as Record<string, number> | undefined) ?? undefined,
  };
}
export function parseHatcherMetadata(
  metadata: Array<{ key: string; value: string }> | undefined,
): HatcherMetadata | null {
  if (!metadata?.length) return null;
  const row = metadata.find((m) => m.key.trim().toLowerCase() === HATCHER_METADATA_KEY.toLowerCase());
  if (!row?.value?.trim()) return null;
  try {
    const parsed = JSON.parse(row.value) as StoredHatcherMetadata;
    if (parsed?.version !== 1) return null;
    return normalizeStoredHatcherMetadata(parsed);
  } catch {
    return null;
  }
}
export function serializeHatcherMetadata(meta: HatcherMetadata): string {
  return JSON.stringify(meta);
}
export type HatcherDetailFetchResult = {
  publicStats: unknown | null;
  passportSnapshot: unknown | null;
  mcpManifestSnapshot: unknown | null;
  fetchedAt: string;
};
/** Merge new detail fetches with prior snapshot — keep prior data when fetch returns null. */
export function mergeHatcherDetailSnapshots(
  prior: HatcherMetadata | null,
  fetched: HatcherDetailFetchResult,
): Pick<
  HatcherMetadata,
  "passportSnapshot" | "mcpManifestSnapshot" | "publicStatsSnapshot" | "lastDetailFetchAt"
> {
  const passportSnapshot =
    fetched.passportSnapshot !== null
      ? fetched.passportSnapshot
      : (prior?.passportSnapshot ?? null);
  const mcpManifestSnapshot =
    fetched.mcpManifestSnapshot !== null
      ? fetched.mcpManifestSnapshot
      : (prior?.mcpManifestSnapshot ?? null);
  const publicStatsSnapshot =
    fetched.publicStats !== null
      ? fetched.publicStats
      : (prior?.publicStatsSnapshot ?? null);
  return {
    passportSnapshot,
    mcpManifestSnapshot,
    publicStatsSnapshot,
    lastDetailFetchAt: fetched.fetchedAt,
  };
}
export function buildHatcherMetadataFromExplore(
  agent: HatcherExploreAgent,
  extras: {
    prior?: HatcherMetadata | null;
    details?: HatcherDetailFetchResult | null;
    badge?: HatcherMetadataBadge;
    source?: HatcherMetadataSource;
  } = {},
): HatcherMetadata {
  const hatcherId = agent.id.trim();
  const slug = agent.slug?.trim() ?? "";
  const publicId = hatcherPublicId({ id: hatcherId, slug });
  const links = buildHatcherLinks(publicId, hatcherId);
  const now = new Date().toISOString();
  const owner = {
    username: agent.owner?.username?.trim() || undefined,
    walletAddressTruncated: hatcherTruncateWallet(agent.owner?.walletAddress),
  };
  const detailMerge = extras.details
    ? mergeHatcherDetailSnapshots(extras.prior ?? null, extras.details)
    : {};
  const partial: HatcherMetadata = {
    version: 1,
    hatcherId,
    slug,
    publicId,
    framework: agent.framework ?? "",
    template: agent.template ?? "",
    status: (agent.status ?? "unknown").toLowerCase(),
    messageCount: agent.messageCount ?? 0,
    publicChatEnabled: agent.publicChatEnabled === true,
    createdAt: agent.createdAt ?? undefined,
    owner,
    source: extras.source ?? "explore",
    badge: extras.badge ?? "indexed",
    links,
    passportSnapshot: detailMerge.passportSnapshot ?? extras.prior?.passportSnapshot ?? null,
    mcpManifestSnapshot: detailMerge.mcpManifestSnapshot ?? extras.prior?.mcpManifestSnapshot ?? null,
    publicStatsSnapshot: detailMerge.publicStatsSnapshot ?? extras.prior?.publicStatsSnapshot ?? null,
    lastIndexedAt: now,
    lastDetailFetchAt: detailMerge.lastDetailFetchAt ?? extras.prior?.lastDetailFetchAt ?? null,
  };
  const scored = computeHatcherPartnerScore({ meta: partial, explore: agent });
  return {
    ...partial,
    partnerScore: scored.score,
    partnerScoreBreakdown: scored.breakdown,
  };
}
function metadataHasHatcherId(
  metadata: Array<{ key: string; value: string }> | undefined,
): boolean {
  if (!metadata?.length) return false;
  return metadata.some(
    (m) => m.key.trim().toLowerCase() === HATCHER_ID_METADATA_KEY.toLowerCase() && m.value.trim().length > 0,
  );
}
export function buildHatcherDetail(
  agent: {
    chainId: number;
    listingRegistrySource?: string | null;
  },
  metadata?: Array<{ key: string; value: string }>,
): HatcherDetailPayload {
  const isHatcher =
    agent.chainId === HATCHER_CHAIN_ID ||
    agent.listingRegistrySource === HATCHER_LISTING_REGISTRY_SOURCE ||
    metadataHasHatcherId(metadata);
  const hatcher = parseHatcherMetadata(metadata);
  if (!isHatcher) {
    return {
      isHatcher: false,
      hatcher: null,
      partnerScore: 0,
      partnerScoreBreakdown: {},
    };
  }
  const partnerScore = hatcher?.partnerScore ?? 0;
  const partnerScoreBreakdown = hatcher?.partnerScoreBreakdown ?? {};
  return {
    isHatcher: true,
    hatcher,
    partnerScore,
    partnerScoreBreakdown,
  };
}
