import "server-only";

import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import { agentPublicPath } from "@/lib/agent-public-url";
import { AGENT_WORLD_AR_CHAIN_ID } from "@/lib/public-site/world-types";
import { isAgentSolanaDirectoryListed } from "@/lib/agent-solana-registration/display";
import { prisma } from "@/lib/db";
import { homeArScore } from "@/lib/home-discovery-display";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import { resolveTokenCardSocials } from "@/lib/public-site/token-card-market";
import type { AgentWorldAgentPreview } from "@/lib/public-site/world-types";

export const WORLD_CLUSTER_AGENTS_MAX = 500;
export const WORLD_SNAPSHOT_PREVIEWS_MAX = 768;
export const WORLD_SNAPSHOT_PREVIEWS_PER_CLUSTER_MAX = 64;

const PREVIEW_DESCRIPTION_MAX = 140;
const PREVIEW_NAME_MAX = 96;
const PREVIEW_URL_MAX = 2_048;
const SNAPSHOT_QUERY_OVERSAMPLE = 2;
const AGENT_SOCIAL_METADATA_KEYS = [
  "twitter",
  "telegram",
  "website",
  "twitterUrl",
  "telegramUrl",
  "websiteUrl",
] as const;

function clipPreviewDescription(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= PREVIEW_DESCRIPTION_MAX) return trimmed;
  return `${trimmed.slice(0, PREVIEW_DESCRIPTION_MAX - 1).trimEnd()}…`;
}

function clipPreviewName(value: string, agentId: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ") || `Agent ${agentId}`;
  if (trimmed.length <= PREVIEW_NAME_MAX) return trimmed;
  return `${trimmed.slice(0, PREVIEW_NAME_MAX - 1).trimEnd()}…`;
}

function compactPreviewUrl(value: string | null): string | null {
  if (!value || value.length > PREVIEW_URL_MAX) return null;
  return value;
}

function compactPreviewImageUrl(value: string | null | undefined): string {
  const resolved = sanitizeAgentImageUrl(value);
  if (
    !resolved ||
    resolved.length > PREVIEW_URL_MAX ||
    resolved.startsWith("data:") ||
    resolved.startsWith("blob:")
  ) {
    return "";
  }
  return resolved;
}

function isListedVerified(row: {
  readonly isVerified: boolean;
  readonly isPremiumVerified: boolean;
  readonly sapVerified: boolean;
  readonly metaplexVerified: boolean;
  readonly publicVerificationStatus: string;
  readonly arVerificationStatus: string;
}): boolean {
  return (
    row.isVerified ||
    row.isPremiumVerified ||
    row.sapVerified ||
    row.metaplexVerified ||
    row.publicVerificationStatus === "verified" ||
    row.arVerificationStatus === "verified"
  );
}

export function mapWorldAgentRowToPreview(row: {
  readonly agentId: number;
  readonly chainId: number;
  readonly name: string;
  readonly image: string | null;
  readonly description: string;
  readonly isVerified: boolean;
  readonly isPremiumVerified: boolean;
  readonly sapVerified: boolean;
  readonly metaplexVerified: boolean;
  readonly publicVerificationStatus: string;
  readonly arVerificationStatus: string;
  readonly isActive: boolean;
  readonly publiclyActive: boolean;
  readonly x402Support: boolean;
  readonly listedAt: Date | null;
  readonly sourceRegistryAddress: string | null;
  readonly solanaAssetAddress: string | null;
  readonly solanaCanonicalStatus: string | null;
  readonly chain: { readonly shortName: string };
  readonly metadata: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly agentLaunches: ReadonlyArray<{
    readonly profileWebsite: string | null;
    readonly profileTwitter: string | null;
    readonly profileTelegram: string | null;
  }>;
}): AgentWorldAgentPreview {
  const meta = new Map(
    row.metadata.map((entry) => [entry.key.toLowerCase(), entry.value] as const),
  );
  const launch = row.agentLaunches[0];
  const socials = resolveTokenCardSocials({
    twitter: launch?.profileTwitter || meta.get("twitter") || meta.get("twitterurl") || null,
    telegram: launch?.profileTelegram || meta.get("telegram") || meta.get("telegramurl") || null,
    website: launch?.profileWebsite || meta.get("website") || meta.get("websiteurl") || null,
  });
  return {
    chainId: row.chainId,
    agentId: row.agentId,
    name: clipPreviewName(row.name, row.agentId),
    image: compactPreviewImageUrl(row.image),
    description: clipPreviewDescription(row.description),
    href: agentPublicPath(row),
    score: homeArScore(row),
    verified: isListedVerified(row),
    live: row.isActive && row.publiclyActive,
    registered:
      isAgentSolanaDirectoryListed(row) ||
      Boolean(row.sourceRegistryAddress?.trim()) ||
      row.chainId === AGENT_WORLD_AR_CHAIN_ID,
    x402: row.x402Support,
    listedAt: row.listedAt instanceof Date ? row.listedAt.toISOString() : null,
    chainShortName: row.chain.shortName,
    socials: {
      twitter: compactPreviewUrl(socials.twitter),
      telegram: compactPreviewUrl(socials.telegram),
      website: compactPreviewUrl(socials.website),
    },
  };
}

function rankWorldAgentRows<
  T extends {
    readonly agentId: number;
    readonly image: string | null;
    readonly agentRankScore: number | null;
    readonly score: number | null;
  },
>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftImage = compactPreviewImageUrl(left.image) ? 1 : 0;
    const rightImage = compactPreviewImageUrl(right.image) ? 1 : 0;
    if (leftImage !== rightImage) return rightImage - leftImage;
    const leftScore = homeArScore(left);
    const rightScore = homeArScore(right);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.agentId - right.agentId;
  });
}

async function queryWorldAgentRows(chainId: number, take: number) {
  const publicWhere = await extendAgentWhereIndexable();
  return prisma.agent.findMany({
    where: { AND: [publicWhere, { chainId }] },
    orderBy: [{ agentRankScore: "desc" }, { score: "desc" }, { id: "asc" }],
    take,
    select: {
      agentId: true,
      chainId: true,
      name: true,
      image: true,
      description: true,
      agentRankScore: true,
      score: true,
      isVerified: true,
      isPremiumVerified: true,
      sapVerified: true,
      metaplexVerified: true,
      publicVerificationStatus: true,
      arVerificationStatus: true,
      isActive: true,
      publiclyActive: true,
      x402Support: true,
      listedAt: true,
      sourceRegistryAddress: true,
      solanaAssetAddress: true,
      solanaCanonicalStatus: true,
      chain: { select: { shortName: true } },
      metadata: {
        where: { key: { in: [...AGENT_SOCIAL_METADATA_KEYS] } },
        select: { key: true, value: true },
      },
      agentLaunches: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          profileWebsite: true,
          profileTwitter: true,
          profileTelegram: true,
        },
      },
    },
  });
}

export async function loadWorldClusterAgents(
  chainId: number,
  options?: { readonly limit?: number },
): Promise<{ readonly agents: readonly AgentWorldAgentPreview[]; readonly total: number }> {
  const limit = Math.min(
    Math.max(1, options?.limit ?? WORLD_CLUSTER_AGENTS_MAX),
    WORLD_CLUSTER_AGENTS_MAX,
  );
  const publicWhere = await extendAgentWhereIndexable();
  const where = { AND: [publicWhere, { chainId }] };

  const [total, rows] = await Promise.all([
    prisma.agent.count({ where }),
    queryWorldAgentRows(chainId, limit),
  ]);

  return {
    agents: rankWorldAgentRows(rows).map(mapWorldAgentRowToPreview),
    total,
  };
}

export async function loadWorldAgentPreviewsForSnapshot(
  chainIds: readonly number[],
): Promise<AgentWorldAgentPreview[]> {
  if (chainIds.length === 0) return [];
  const uniqueChainIds = [...new Set(chainIds)];
  const perClusterLimit = Math.max(
    1,
    Math.min(
      WORLD_SNAPSHOT_PREVIEWS_PER_CLUSTER_MAX,
      Math.floor(WORLD_SNAPSHOT_PREVIEWS_MAX / uniqueChainIds.length),
    ),
  );
  const rowsByChain = await Promise.all(
    uniqueChainIds.map((chainId) =>
      queryWorldAgentRows(chainId, perClusterLimit * SNAPSHOT_QUERY_OVERSAMPLE),
    ),
  );

  const previewsByChain = rowsByChain.map((rows) =>
    rankWorldAgentRows(rows).slice(0, perClusterLimit).map(mapWorldAgentRowToPreview),
  );
  const previews: AgentWorldAgentPreview[] = [];

  // Interleave chains so any later serialized-size trimming degrades evenly instead
  // of dropping every preview belonging to chains near the end of the directory.
  for (let index = 0; index < perClusterLimit; index += 1) {
    for (const chainPreviews of previewsByChain) {
      const preview = chainPreviews[index];
      if (preview) previews.push(preview);
      if (previews.length >= WORLD_SNAPSHOT_PREVIEWS_MAX) return previews;
    }
  }

  return previews;
}
