import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { extendAgentWhereNotBlocked, loadBlockedAgentIds } from "@/lib/agent-blocklist";
type DayCountRow = { day: Date; count: bigint };
type ChainFeedbackCountRow = { shortName: string; color: string; count: bigint };
type ScoreBucketRow = { bucket: number; count: bigint };
export const maxDuration = 30;
const CACHE_HEADERS = {
  "Cache-Control": "s-maxage=120, stale-while-revalidate=240",
};
/** Site feedback uses the 1–5 star scale; on-chain protocol scores are a separate domain. */
const SITE_FEEDBACK_WHERE = {
  feedbackIndex: null,
  sourceRegistry: null,
  revoked: false,
  value: { gte: 1, lte: 5 },
} satisfies Prisma.FeedbackWhereInput;
export async function GET() {
  const [visibleAgentWhere, blockedAgentIds] = await Promise.all([
    extendAgentWhereNotBlocked({}),
    loadBlockedAgentIds(),
  ]);
  const visibleAgentSql = blockedAgentIds.length > 0
    ? Prisma.sql`AND a.id NOT IN (${Prisma.join(blockedAgentIds)})`
    : Prisma.empty;
  const visibleAgent = (base: Prisma.AgentWhereInput): Prisma.AgentWhereInput => ({
    AND: [visibleAgentWhere, base],
  });
  const siteFeedbackWhere: Prisma.FeedbackWhereInput = {
    ...SITE_FEEDBACK_WHERE,
    agent: visibleAgentWhere,
  };
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    starCountsRaw,
    last30DaysFeedbackRaw,
    topAgentsByScoreRaw,
    topAgentsByFeedbackRaw,
    chainGroupsRaw,
    last30dAgentsRaw,
    totalStats,
    registryStats,
    scoreDistRaw,
    activityStats,
    archetypeDistRaw,
    chainAgentCountRaw,
    executionScoreDistRaw,
    verifiedRevenueAgents,
    premiumVerified,
    standardVerified,
    agentModeDistRaw,
    topServicesRaw,
  ] = await Promise.all([
    // 1-5 star distribution
    Promise.all(
      [1, 2, 3, 4, 5].map((s) =>
        prisma.feedback.count({
          where: {
            AND: [siteFeedbackWhere, { value: { gte: s - 0.5, lt: s + 0.5 } }],
          },
        })
      )
    ),
    // Aggregate by day in PostgreSQL rather than materializing every feedback row.
    prisma.$queryRaw<DayCountRow[]>`
      SELECT DATE_TRUNC('day', f."createdAt") AS day, COUNT(*)::bigint AS count
      FROM "Feedback" f
      JOIN "Agent" a ON a.id = f."agentId"
      WHERE f."createdAt" >= ${since30d}
        AND f."feedbackIndex" IS NULL
        AND f."source_registry" IS NULL
        AND f.revoked = FALSE
        AND f.value >= 1 AND f.value <= 5
        ${visibleAgentSql}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    // Top 10 agents by score
    prisma.agent.findMany({
      where: visibleAgent({ isActive: true, score: { gt: 0 } }),
      select: {
        id: true,
        agentId: true,
        chainId: true,
        name: true,
        score: true,
        rank: true,
        isVerified: true,
        isPremiumVerified: true,
        archetype: true,
        chain: { select: { shortName: true, color: true, icon: true } },
      },
      orderBy: { score: "desc" },
      take: 10,
    }),
    // Top 8 agents by average feedback score (min 1 feedback)
    prisma.feedback.groupBy({
      by: ["agentId"],
      where: siteFeedbackWhere,
      _avg: { value: true },
      _count: { id: true },
      having: { id: { _count: { gte: 1 } } },
      orderBy: { _avg: { value: "desc" } },
      take: 8,
    }),
    // Aggregate by chain in PostgreSQL rather than loading one joined row per feedback.
    prisma.$queryRaw<ChainFeedbackCountRow[]>`
      SELECT c."shortName" AS "shortName", c.color AS color, COUNT(*)::bigint AS count
      FROM "Feedback" f
      JOIN "Agent" a ON a.id = f."agentId"
      JOIN "Chain" c ON c."chainId" = a."chainId"
      WHERE f."feedbackIndex" IS NULL
        AND f."source_registry" IS NULL
        AND f.revoked = FALSE
        AND f.value >= 1 AND f.value <= 5
        ${visibleAgentSql}
      GROUP BY c."chainId", c."shortName", c.color
      ORDER BY count DESC
      LIMIT 8
    `,
    // Aggregate registrations by day in PostgreSQL.
    prisma.$queryRaw<DayCountRow[]>`
      SELECT DATE_TRUNC('day', a."createdAt") AS day, COUNT(*)::bigint AS count
      FROM "Agent" a
      WHERE a."createdAt" >= ${since30d}
        ${visibleAgentSql}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    // Overall feedback stats
    prisma.feedback.aggregate({
      where: siteFeedbackWhere,
      _count: { id: true },
      _avg: { value: true },
    }),
    // Registry stats
    Promise.all([
      prisma.agent.count({ where: visibleAgentWhere }),
      prisma.agent.count({ where: visibleAgent({ isActive: true }) }),
      prisma.agent.count({ where: visibleAgent({ OR: [{ isVerified: true }, { isPremiumVerified: true }] }) }),
      prisma.chain.count({ where: { isActive: true } }),
    ]),
    // Compute histogram buckets in PostgreSQL.
    prisma.$queryRaw<ScoreBucketRow[]>`
      SELECT LEAST(9, FLOOR(a."score" / 10)::int) AS bucket, COUNT(*)::bigint AS count
      FROM "Agent" a
      WHERE a."isActive" = true AND a."score" > 0
        ${visibleAgentSql}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    // Activity stats: agents active in last 24h / 7d / 30d
    Promise.all([
      prisma.agent.count({ where: visibleAgent({ isActive: true, lastActiveAt: { gte: since24h } }) }),
      prisma.agent.count({ where: visibleAgent({ isActive: true, lastActiveAt: { gte: since7d } }) }),
      prisma.agent.count({ where: visibleAgent({ isActive: true, lastActiveAt: { gte: since30d } }) }),
    ]),
    // Archetype distribution
    prisma.agent.groupBy({
      by: ["archetype"],
      where: visibleAgent({ isActive: true, archetype: { not: "" } }),
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    // Agents per chain
    prisma.agent.groupBy({
      by: ["chainId"],
      where: visibleAgent({ isActive: true }),
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 12,
    }),
    // Compute the on-chain histogram in PostgreSQL.
    prisma.$queryRaw<ScoreBucketRow[]>`
      SELECT LEAST(9, FLOOR(a."executionScore"::numeric / 10)::int) AS bucket, COUNT(*)::bigint AS count
      FROM "Agent" a
      WHERE a."isActive" = true AND a."executionScore" > 0
        ${visibleAgentSql}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.agent.count({ where: visibleAgent({ isActive: true, isVerifiedRevenue: true }) }),
    prisma.agent.count({ where: visibleAgent({ isActive: true, isPremiumVerified: true }) }),
    prisma.agent.count({
      where: visibleAgent({ isActive: true, isVerified: true, isPremiumVerified: false }),
    }),
    prisma.agent.groupBy({
      by: ["agentMode"],
      where: visibleAgent({ isActive: true }),
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.agentService.groupBy({
      by: ["name"],
      where: { agent: visibleAgent({ isActive: true }) },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 12,
    }),
  ]);
  // Build star distribution
  const feedbackScoreDistribution = [1, 2, 3, 4, 5].map((s, i) => ({
    range: `${s}★`,
    count: starCountsRaw[i],
  }));
  // Build last 30 days feedback map
  const dayMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of last30DaysFeedbackRaw) {
    const key = row.day.toISOString().slice(0, 10);
    if (dayMap.has(key)) dayMap.set(key, Number(row.count));
  }
  const feedbackTrend30d = Array.from(dayMap.entries()).map(([date, count]) => ({ date, count }));
  // Enrich top feedback agents
  const topFeedbackAgentIds = topAgentsByFeedbackRaw.map((r) => r.agentId);
  const topFeedbackDetails = await prisma.agent.findMany({
    where: visibleAgent({ id: { in: topFeedbackAgentIds } }),
    select: {
      id: true, agentId: true, chainId: true, name: true,
      chain: { select: { shortName: true, color: true, icon: true } },
    },
  });
  const topFeedbackMap = new Map(topFeedbackDetails.map((a) => [a.id, a]));
  const topAgentsByFeedback = topAgentsByFeedbackRaw
    .map((r) => {
      const agent = topFeedbackMap.get(r.agentId);
      if (!agent) return null;
      return {
        name: agent.name,
        chainId: agent.chainId,
        agentId: agent.agentId,
        chain: agent.chain,
        avgScore: Math.round(Math.min(5, Math.max(1, r._avg.value ?? 0)) * 10) / 10,
        feedbackCount: r._count.id,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a != null);
  const feedbackByChain = chainGroupsRaw.map((row) => ({
    shortName: row.shortName,
    color: row.color,
    count: Number(row.count),
  }));
  // Agent registrations last 30 days
  const regMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    regMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of last30dAgentsRaw) {
    const key = row.day.toISOString().slice(0, 10);
    if (regMap.has(key)) regMap.set(key, Number(row.count));
  }
  const agentRegistrations = Array.from(regMap.entries()).map(([date, count]) => ({ date, count }));
  // Registry stats
  const [totalAgents, activeAgents, verifiedAgents, activeChains] = registryStats;
  // Score distribution: 10-bucket histogram
  const scoreBuckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${(i + 1) * 10}`,
    count: 0,
  }));
  for (const row of scoreDistRaw) {
    if (row.bucket >= 0 && row.bucket < scoreBuckets.length) {
      scoreBuckets[row.bucket]!.count = Number(row.count);
    }
  }
  // On-chain score distribution: 10-bucket histogram (only non-zero agents)
  const executionBuckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${(i + 1) * 10}`,
    count: 0,
  }));
  for (const row of executionScoreDistRaw) {
    if (row.bucket >= 0 && row.bucket < executionBuckets.length) {
      executionBuckets[row.bucket]!.count = Number(row.count);
    }
  }
  // Activity stats
  const [active24h, active7d, active30d] = activityStats;
  // Archetype distribution
  const archetypeDistribution = archetypeDistRaw.map((r) => ({
    archetype: r.archetype,
    count: r._count.id,
  }));
  // Agent mode distribution — merge empty string into "unknown"
  const modeCountMap = new Map<string, number>();
  for (const row of agentModeDistRaw) {
    const raw = row.agentMode?.trim() ?? "";
    const mode = raw === "" ? "unknown" : raw;
    modeCountMap.set(mode, (modeCountMap.get(mode) ?? 0) + row._count.id);
  }
  const agentModeDistribution = [...modeCountMap.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count);
  const topServices = topServicesRaw.map((r) => ({
    name: r.name,
    count: r._count.id,
  }));
  // Agents per chain — enrich with chain name/color
  const chainIds = chainAgentCountRaw.map((r) => r.chainId);
  const chainDetails = await prisma.chain.findMany({
    where: { chainId: { in: chainIds } },
    select: { chainId: true, shortName: true, color: true },
  });
  const chainDetailMap = new Map(chainDetails.map((c) => [c.chainId, c]));
  const agentsByChain = chainAgentCountRaw.map((r) => ({
    shortName: chainDetailMap.get(r.chainId)?.shortName ?? `Chain ${r.chainId}`,
    color: chainDetailMap.get(r.chainId)?.color ?? "#888",
    count: r._count.id,
  }));
  // Top agents by score (already fetched)
  const topByScore = topAgentsByScoreRaw.map((a) => ({
    name: a.name,
    chainId: a.chainId,
    agentId: a.agentId,
    chain: a.chain,
    score: Math.round(a.score),
    rank: a.rank,
    isVerified: a.isVerified,
    isPremiumVerified: a.isPremiumVerified,
    archetype: a.archetype,
  }));
  return NextResponse.json(
    {
      feedbackScoreDistribution,
      topAgentsByFeedback,
      feedbackByChain,
      agentRegistrations,
      summary: {
        totalFeedback: totalStats._count.id,
        avgScore: Math.round((totalStats._avg.value ?? 0) * 10) / 10,
      },
      feedbackTrend30d,
      registryStats: {
        totalAgents,
        activeAgents,
        verifiedAgents,
        activeChains,
        verifiedRevenueAgents,
        premiumVerified,
        standardVerified,
      },
      agentModeDistribution,
      topServices,
      topByScore,
      scoreDistribution: scoreBuckets,
      executionScoreDistribution: executionBuckets,
      activityStats: { active24h, active7d, active30d },
      archetypeDistribution,
      agentsByChain,
    },
    { headers: CACHE_HEADERS }
  );
}
