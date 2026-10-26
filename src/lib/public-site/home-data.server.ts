import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AGENTRANKING_LISTING_SOURCE } from "@/lib/dashboard/native-agent";
import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { loadAllLaunchIndexCards } from "@/lib/agent-launch/launch-index-data.server";
import { getEcosystemExtensionCounts } from "@/lib/ecosystem-statistics";
import { getCountersPayload } from "@/lib/public-statistics/service";
import type { PublicAgentPreview } from "@/lib/public-site/types";
import type {
  PublicSiteHomeData,
  PublicSiteHomeStats,
  SphereImageData,
  LandingRankedAgent,
} from "@/lib/public-site/home-types";
import {
  loadPublicAgentsPreview,
  pickPublicAgentLinkedTokenFromPreview,
} from "@/lib/public-agents";
import { socialsFromPublicAgentPreview } from "@/lib/public-agent-display";
import { resolveTokenCardSocials } from "@/lib/public-site/token-card-market";
import { resolvePublicHomeStats } from "@/lib/public-platform-stats";
import { getPublicAgentVerificationStatus } from "@/lib/public-site/agent-verification";
import { isAccountVerifiedStatus } from "@/lib/verification/account-verification-types";
import { toPublicAgentCredential } from "@/lib/verification/public-agent-credential";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import { publicTokenDetailHref } from "@/lib/public-site/routes";
import { agentPublicPath } from "@/lib/agent-public-url";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import { isMetaplexGenesisLaunch } from "@/lib/agent-launch/launch-venue";
import { readPublicRankingPage } from "@/lib/ranking/public-ranking.server";
const PREVIEW_LIMIT = 6;
const TOKEN_PREVIEW_LIMIT = 16;
const SPHERE_AGENT_LIMIT = 40;
const LANDING_RANKED_LIMIT = 5;

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "AR";
}

function mapPreviewToLandingRanked(agent: PublicAgentPreview, rank: number): LandingRankedAgent {
  const verified = getPublicAgentVerificationStatus(agent).isVerified;
  let chainLabel = "AgentRanking";
  if (agent.linkedTokenVenue === "Robinhood") {
    chainLabel = "Robinhood";
  } else if (agent.linkedTokenVenue) {
    chainLabel = "Solana · AgentRanking";
  }
  const description = agent.description.trim();
  const category = description
    ? description.length <= 28
      ? description
      : `${description.slice(0, 25).trim()}…`
    : "Native agent";
  return {
    rank: String(rank).padStart(2, "0"),
    href: agent.profileHref,
    initials: initialsFromName(agent.name),
    name: agent.name,
    verified,
    chains: chainLabel,
    category,
    score: agent.agentRankScore != null && agent.agentRankScore > 0
      ? agent.agentRankScore.toFixed(1)
      : "—",
    imageUrl: sanitizeAgentImageUrl(agent.image) || "",
  };
}

async function loadLandingRankedAgents(): Promise<LandingRankedAgent[]> {
  if (process.env.NEXT_PHASE === "phase-production-build") return [];
  const network = getAgentLaunchConfig().network;
  const select = launchedAgentPreviewSelect(network);
  const publicWhere = await extendAgentWhereIndexable();
  const nativeRows = await prisma.agent.findMany({
    where: {
      AND: [
        publicWhere,
        {
          listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
          chainId: AGENTRANKING_NATIVE_CHAIN_ID,
        },
      ],
    },
    orderBy: [{ agentRankScore: "desc" }, { listedAt: "desc" }, { id: "desc" }],
    take: LANDING_RANKED_LIMIT,
    select,
  });
  const ranked: LandingRankedAgent[] = mapAgentsToPreviews(nativeRows).map((agent, index) =>
    mapPreviewToLandingRanked(agent, index + 1),
  );
  if (ranked.length >= LANDING_RANKED_LIMIT) return ranked;

  const rankingPage = await readPublicRankingPage({
    query: "",
    chainId: null,
    verifiedOnly: false,
    x402Only: false,
    mppOnly: false,
    direction: "after",
    cursor: null,
  });
  const seen = new Set(ranked.map((agent) => agent.href));
  for (const row of rankingPage.agents) {
    if (seen.has(row.profilePath)) continue;
    seen.add(row.profilePath);
    ranked.push({
      rank: String(ranked.length + 1).padStart(2, "0"),
      href: row.profilePath,
      initials: initialsFromName(row.name),
      name: row.name,
      verified: row.verified,
      chains: row.chain.shortName,
      category: row.protocol,
      score: row.arScore > 0 ? row.arScore.toFixed(1) : "—",
      imageUrl: row.image,
    });
    if (ranked.length >= LANDING_RANKED_LIMIT) break;
  }
  return ranked;
}

const AGENT_SOCIAL_METADATA_KEYS = [
  "twitter",
  "telegram",
  "website",
  "twitterUrl",
  "telegramUrl",
  "websiteUrl",
] as const;

function launchedAgentPreviewSelect(network: string): Prisma.AgentSelect {
  return {
    id: true,
    agentId: true,
    chainId: true,
    name: true,
    image: true,
    description: true,
    score: true,
    agentRankScore: true,
    isVerified: true,
    isPremiumVerified: true,
    publicVerificationStatus: true,
    arVerificationStatus: true,
    ownerAccount: {
      select: {
        verificationStatus: true,
        verificationExpiresAt: true,
      },
    },
    lastActiveAt: true,
    listedAt: true,
    tokenAddress: true,
    metaplexAgentTokenMint: true,
    metadata: {
      where: { key: { in: [...AGENT_SOCIAL_METADATA_KEYS] } },
      select: { key: true, value: true },
    },
    agentLaunches: {
      where: {
        network,
        launchStatus: "indexed",
        feeSharingStatus: "active",
        mint: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: {
        id: true,
        mint: true,
        tokenSymbol: true,
        tokenName: true,
        launchKind: true,
        launchStatus: true,
        feeSharingStatus: true,
        createdAt: true,
        totalFeesDistributedLamports: true,
        profileWebsite: true,
        profileTwitter: true,
        profileTelegram: true,
      },
    },
  };
}

async function fetchSphereAgentImages(limit: number): Promise<SphereImageData[]> {
  const publicWhere = await extendAgentWhereIndexable();
  const rows = await prisma.agent.findMany({
    where: publicWhere,
    orderBy: { score: "desc" },
    take: limit * 3,
    select: { id: true, name: true, image: true },
  });
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const src = r.image?.trim();
      if (!src || seen.has(src)) return false;
      seen.add(src);
      return true;
    })
    .slice(0, limit)
    .map((r) => ({
      id: String(r.id),
      src: sanitizeAgentImageUrl(r.image),
      alt: r.name,
    }))
    .filter((entry) => Boolean(entry.src));
}

function mapAgentsToPreviews(
  rows: Awaited<ReturnType<typeof loadPublicAgentsPreview>>,
): PublicAgentPreview[] {
  const mapped = rows.map((agent): PublicAgentPreview => {
    const linkedToken = pickPublicAgentLinkedTokenFromPreview(agent);
    const linkedLaunch = agent.agentLaunches[0] ?? null;
    const linkedTokenVenue: PublicAgentPreview["linkedTokenVenue"] = linkedToken
      ? isMetaplexGenesisLaunch(linkedLaunch?.launchKind ?? null)
        ? "Metaplex"
        : "PumpSwap"
      : null;
    const tokenized = Boolean(
      linkedToken || agent.tokenAddress || agent.metaplexAgentTokenMint,
    );
    const listedAt =
      agent.listedAt instanceof Date
        ? agent.listedAt.toISOString()
        : typeof agent.listedAt === "string"
          ? agent.listedAt
          : null;
    const lastActiveAt =
      agent.lastActiveAt instanceof Date
        ? agent.lastActiveAt.toISOString()
        : typeof agent.lastActiveAt === "string"
          ? agent.lastActiveAt
          : null;
    const ownerAccountVerified = agent.ownerAccount
      ? isAccountVerifiedStatus(
          agent.ownerAccount.verificationStatus,
          agent.ownerAccount.verificationExpiresAt,
        )
      : false;
    return {
      id: agent.id,
      name: agent.name,
      image: sanitizeAgentImageUrl(agent.image),
      description: agent.description,
      publicVerificationStatus: agent.publicVerificationStatus,
      arVerificationStatus: ownerAccountVerified
        ? "verified"
        : (agent.arVerificationStatus ?? null),
      ownerAccountVerified,
      credential: toPublicAgentCredential(agent.ownerAccount ?? null),
      isVerified: ownerAccountVerified || agent.isVerified,
      tokenized,
      profileHref: agentPublicPath(agent),
      linkedTokenLabel: linkedToken
        ? linkedToken.tokenSymbol
          ? `$${linkedToken.tokenSymbol}`
          : linkedToken.tokenName ?? "View token"
        : null,
      linkedTokenHref: linkedToken ? publicTokenDetailHref(linkedToken.mint) : null,
      linkedTokenVenue,
      agentRankScore: agent.agentRankScore ?? null,
      lastActiveAt,
      listedAt,
      socials: resolveTokenCardSocials(socialsFromPublicAgentPreview(agent)),
    };
  });
  // Newest first for live bump strip; verified still wins ties within same day.
  return mapped.sort((a, b) => {
    const aListed = Date.parse(a.listedAt ?? "") || 0;
    const bListed = Date.parse(b.listedAt ?? "") || 0;
    if (bListed !== aListed) return bListed - aListed;
    const aVerified = getPublicAgentVerificationStatus(a).isVerified;
    const bVerified = getPublicAgentVerificationStatus(b).isVerified;
    if (aVerified && !bVerified) return -1;
    if (!aVerified && bVerified) return 1;
    return (b.agentRankScore ?? 0) - (a.agentRankScore ?? 0);
  });
}
function buildStatsStub(): PublicSiteHomeStats {
  return resolvePublicHomeStats({
    totalAgents: 0,
    totalChains: 0,
    verifiedAgents: 0,
    sapVerifiedAgents: 0,
    mcpAgents: 0,
    generatedAt: new Date().toISOString(),
  });
}
async function getPublicSiteHomeStats(): Promise<PublicSiteHomeStats> {
  if (process.env.NEXT_PHASE === "phase-production-build") return buildStatsStub();
  const [counters, extensions] = await Promise.all([
    getCountersPayload(),
    getEcosystemExtensionCounts(),
  ]);
  const generatedAt = Date.parse(counters.generatedAt) <= Date.parse(extensions.generatedAt)
    ? counters.generatedAt
    : extensions.generatedAt;
  return resolvePublicHomeStats({
    totalAgents: counters.value.totalAgents,
    totalChains: counters.value.totalChains,
    verifiedAgents: counters.value.verifiedAgents,
    sapVerifiedAgents: counters.value.sapVerifiedAgents,
    mcpAgents: extensions.value.mcpAgents,
    generatedAt,
  });
}
export async function loadPublicSiteHomeData(): Promise<PublicSiteHomeData> {
  const [stats, tokenCards, agentRows, rankedAgents, sphereAgents, tokenLaunchCount, nativeAgentCount] =
    await Promise.all([
    getPublicSiteHomeStats(),
    loadAllLaunchIndexCards().then((cards) =>
      cards
        .sort((a, b) => {
          const aUpdated = a.market?.rawUpdatedAt ? Date.parse(a.market.rawUpdatedAt) : 0;
          const bUpdated = b.market?.rawUpdatedAt ? Date.parse(b.market.rawUpdatedAt) : 0;
          if (bUpdated !== aUpdated) return bUpdated - aUpdated;
          const aMcap = a.market?.marketCapUsd ?? a.market?.fdvUsd ?? 0;
          const bMcap = b.market?.marketCapUsd ?? b.market?.fdvUsd ?? 0;
          return bMcap - aMcap;
        })
        .slice(0, TOKEN_PREVIEW_LIMIT),
    ),
    loadPublicAgentsPreview(PREVIEW_LIMIT),
    loadLandingRankedAgents(),
    fetchSphereAgentImages(SPHERE_AGENT_LIMIT),
    prisma.agentLaunch
      .count({
            where: {
              network: getAgentLaunchConfig().network,
              launchStatus: "indexed",
              feeSharingStatus: "active",
              mint: { not: null },
            },
      }),
    prisma.agent
      .count({
        where: {
          listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
          chainId: AGENTRANKING_NATIVE_CHAIN_ID,
          ownerAccountId: { not: null },
          agentWalletId: { not: null },
          isActive: true,
        },
      }),
  ]);
  return {
    stats,
    tokenLaunchCount,
    nativeAgentCount,
    tokens: tokenCards,
    agents: mapAgentsToPreviews(agentRows),
    rankedAgents,
    sphereAgents,
  };
}
