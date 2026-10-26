import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { mapHomeAgentRow } from "@/lib/map-home-agent-row";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import { activeHolderPowerBoostRelationFind } from "@/lib/leaderboard-filters";
import { findPowerRankingAgents } from "@/lib/leaderboard-power-query";
import { loadRecommendedAgentPool } from "@/lib/recommended-agent-pool";
import { dedupeAgentListByCluster } from "@/lib/agent-chain-list-dedupe";
import { attachSapTwinMatchToAgentsSync, getCachedSapTwinIndex } from "@/lib/sap-name-twin";
/** Minimal select for list-view agent rows. Services included for accurate social trust dimension. */
const AGENT_LIST_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  clusterKey: true,
  agentURI: true,
  sapX402Endpoint: true,
  name: true,
  image: true,
  owner: true,
  score: true,
  hotScore: true,
  powerScore: true,
  activeBoosts: true,
  adminPowerAdjust: true,
  rank: true,
  agentRankScore: true,
  protocolTrustScore: true,
  totalFeedback: true,
  x402Support: true,
  scoreWallet: true,
  scoreMetadata: true,
  scoreServices: true,
  scoreQuality: true,
  scorePopularity: true,
  scoreFreshness: true,
  createdAt: true,
  lastActiveAt: true,
  isVerified: true,
  isPremiumVerified: true,
  sapVerified: true,
  hasDuplicateName: true,
  binanceCompatible: true,
  stars: true,
  chain: true,
  services: { select: { name: true, endpoint: true }, take: 12 },
  metadata: { select: { key: true, value: true } },
} as const;
/** Canonical headline counters in one PostgreSQL round trip. */
export async function computeStatsAggregatesOnly() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const [row] = await prisma.$queryRaw<Array<{
    totalAgents: bigint;
    totalFeedback: bigint;
    activeAgents: bigint;
    totalChains: bigint;
    verifiedAgents: bigint;
    feedbackToday: bigint;
    sapVerifiedAgents: bigint;
  }>>`
    SELECT
      (SELECT COUNT(*) FROM "Agent")::bigint AS "totalAgents",
      (SELECT COUNT(*) FROM "Feedback")::bigint AS "totalFeedback",
      (SELECT COUNT(*) FROM "Agent" WHERE "isActive" = TRUE)::bigint AS "activeAgents",
      (SELECT COUNT(*) FROM "Chain" WHERE "isActive" = TRUE)::bigint AS "totalChains",
      (
        SELECT COUNT(*)
        FROM "Agent"
        WHERE "isActive" = TRUE
          AND ("isVerified" = TRUE OR "isPremiumVerified" = TRUE)
      )::bigint AS "verifiedAgents",
      (
        SELECT COUNT(*)
        FROM "Feedback"
        WHERE "createdAt" >= ${yesterday}
          AND "createdAt" <= ${now}
      )::bigint AS "feedbackToday",
      (
        SELECT COUNT(*)
        FROM "Agent"
        WHERE "isActive" = TRUE AND sap_verified = TRUE
      )::bigint AS "sapVerifiedAgents"
  `;
  if (!row) throw new Error("Statistics counter query returned no row");
  return {
    totalAgents: Number(row.totalAgents),
    totalFeedback: Number(row.totalFeedback),
    activeAgents: Number(row.activeAgents),
    totalChains: Number(row.totalChains),
    verifiedAgents: Number(row.verifiedAgents),
    feedbackToday: Number(row.feedbackToday),
    sapVerifiedAgents: Number(row.sapVerifiedAgents),
  };
}
/** Canonical home-list unit. This intentionally excludes aggregate counters. */
export async function computeStatsListsOnly() {
  const now = new Date();
  const selectHomeAgent = {
    ...AGENT_LIST_SELECT,
    holderAgentPerks: activeHolderPowerBoostRelationFind(now),
  } as const;
  const publicWhere = await extendAgentWhereIndexable();
  const [latestAgents, topRankedByPower, promotedHot, promotedFeatured] = await Promise.all([
    prisma.agent.findMany({
      where: publicWhere,
      select: selectHomeAgent,
      orderBy: [{ listedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
    findPowerRankingAgents(prisma, {
      select: selectHomeAgent,
      take: 20,
      skip: 0,
    }),
    prisma.promotion.findMany({
      where: { slotType: "hot", expiresAt: { gt: now } },
      orderBy: [{ expiresAt: "desc" }, { id: "desc" }],
      take: 2,
      include: { agent: { select: selectHomeAgent } },
    }),
    prisma.promotion.findMany({
      where: { slotType: "featured", expiresAt: { gt: now } },
      orderBy: [{ expiresAt: "desc" }, { id: "desc" }],
      take: 2,
      include: { agent: { select: selectHomeAgent } },
    }),
  ]);
  const promotedHotAgents = promotedHot
    .map((promotion) => promotion.agent)
    .filter((agent): agent is NonNullable<typeof agent> => agent != null);
  const promotedFeaturedAgents = promotedFeatured
    .map((promotion) => promotion.agent)
    .filter((agent): agent is NonNullable<typeof agent> => agent != null);
  const promotedHotIdSet = new Set(promotedHotAgents.map((agent) => agent.id));
  const hot = [
    ...promotedHotAgents,
    ...topRankedByPower.filter((agent) => !promotedHotIdSet.has(agent.id)),
  ].slice(0, 5);
  const hotIdSet = new Set(hot.map((agent) => agent.id));
  const promotedFeaturedIdSet = new Set(promotedFeaturedAgents.map((agent) => agent.id));
  const excludeIds = [...hotIdSet, ...promotedFeaturedIdSet];
  const featuredWhere: Prisma.AgentWhereInput = {
    AND: [publicWhere, { id: { notIn: excludeIds } }],
  };
  type HomeAgentRow = Prisma.AgentGetPayload<{ select: typeof selectHomeAgent }>;
  const [algorithmicFeatured, trending] = await Promise.all([
    loadRecommendedAgentPool<HomeAgentRow>({
      prisma,
      where: featuredWhere,
      select: selectHomeAgent,
      poolSize: 40,
      limit: 5,
    }),
    prisma.agent.findMany({
      where: { AND: [publicWhere, { id: { notIn: excludeIds } }] },
      select: selectHomeAgent,
      orderBy: [{ activityScore: "desc" }, { score: "desc" }, { id: "asc" }],
      take: 5,
    }),
  ]);
  const featured = [...promotedFeaturedAgents, ...algorithmicFeatured].slice(0, 5);
  const [latestMapped, topMapped, featuredMapped, trendingMapped] = await Promise.all([
    dedupeThenMapHomeAgents(latestAgents),
    dedupeThenMapHomeAgents(topRankedByPower),
    dedupeThenMapHomeAgents(featured),
    dedupeThenMapHomeAgents(trending),
  ]);
  return {
    latestAgents: latestMapped,
    topRanked: topMapped,
    featured: featuredMapped,
    trending: trendingMapped,
  };
}
/** Compatibility helper for non-route callers. Public routes cache counters and lists separately. */
export async function computeStatsLive() {
  const [counters, lists] = await Promise.all([
    computeStatsAggregatesOnly(),
    computeStatsListsOnly(),
  ]);
  return { ...counters, ...lists };
}
async function dedupeThenMapHomeAgents<
  T extends {
    chainId: number;
    agentId: number;
    hasDuplicateName?: boolean;
    name: string;
    sapVerified?: boolean | null;
    agentURI?: string | null;
    sapX402Endpoint?: string | null;
    services?: ReadonlyArray<{ name: string; endpoint: string }>;
    metadata?: ReadonlyArray<{ key: string; value: string }>;
    clusterKey?: string | null;
  },
>(rows: T[]) {
  if (rows.length === 0) return [];
  const sapTwinIndex = await getCachedSapTwinIndex();
  const withSapTwin = attachSapTwinMatchToAgentsSync(rows, sapTwinIndex);
  const deduped = await dedupeAgentListByCluster(withSapTwin);
  return deduped.map((row) => ({
    ...mapHomeAgentRow(row as Parameters<typeof mapHomeAgentRow>[0]),
    sapTwinMatch: row.sapTwinMatch,
    deploymentCount: row.deploymentCount,
    chainLogoStack: row.chainLogoStack,
    clusterKey: row.clusterKey,
    hasDuplicateName: row.deploymentCount > 1 ? false : row.hasDuplicateName,
  }));
}
