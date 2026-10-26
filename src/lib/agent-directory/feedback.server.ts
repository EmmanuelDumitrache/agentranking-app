import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { extendAgentWhereNotBlocked, loadBlockedAgentIds } from "@/lib/agent-blocklist";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { feedbackSourceFromIndex, normalizeStoredFeedbackValue } from "@/lib/feedback-normalization";
import { toJsonCompatible } from "@/lib/json-compatible";
import type { PublicFeedbackPageData, PublicFeedbackQuery } from "@/lib/agent-directory/feedback";

async function loadPublicFeedbackRecords(query: PublicFeedbackQuery) {
  const [visibleAgentWhere, blockedAgentIds] = await Promise.all([
    extendAgentWhereNotBlocked({}),
    loadBlockedAgentIds(),
  ]);
  const visibleFeedbackSql = blockedAgentIds.length > 0
    ? Prisma.sql`AND f."agentId" NOT IN (${Prisma.join(blockedAgentIds)})`
    : Prisma.empty;
  const filters: Prisma.FeedbackWhereInput[] = [
    { revoked: false },
    { agent: visibleAgentWhere },
  ];
  if (query.search) {
    filters.push({
      OR: [
        { clientAddress: { contains: query.search, mode: "insensitive" } },
        { agent: { name: { contains: query.search, mode: "insensitive" } } },
      ],
    });
  }
  if (query.source === "onchain") {
    filters.push({ OR: [{ sourceRegistry: { not: null } }, { feedbackIndex: { not: null } }] });
  } else if (query.source === "platform") {
    filters.push({ sourceRegistry: null, feedbackIndex: null });
  }
  const where: Prisma.FeedbackWhereInput = { AND: filters };
  const orderBy: Prisma.FeedbackOrderByWithRelationInput =
    query.sort === "oldest"
      ? { createdAt: "asc" }
      : query.sort === "highest"
        ? { value: "desc" }
        : query.sort === "lowest"
          ? { value: "asc" }
          : { createdAt: "desc" };
  const [feedbacks, total, globalStats, last24h] = await Promise.all([
    prisma.feedback.findMany({
      where,
      include: { agent: { include: { chain: true } } },
      orderBy,
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
    prisma.feedback.count({ where }),
    prisma.$queryRaw<Array<{ totalAll: bigint; uniqueUsers: bigint; avgDisplay: unknown }>>`
      SELECT
        COUNT(*)::bigint AS "totalAll",
        COUNT(DISTINCT "clientAddress")::bigint AS "uniqueUsers",
        AVG(
          LEAST(
            100::numeric,
            GREATEST(
              0::numeric,
              ROUND(
                CASE
                  WHEN "feedbackIndex" IS NULL AND "source_registry" IS NULL THEN
                    (COALESCE("value", 0)::numeric / 5) * 100
                  ELSE COALESCE("value", 0)::numeric
                END
              )
            )
          )
        ) AS "avgDisplay"
      FROM "Feedback" f
      WHERE f.revoked = FALSE
        ${visibleFeedbackSql}
    `,
    prisma.feedback.count({
      where: {
        revoked: false,
        agent: visibleAgentWhere,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
  const statsRow = globalStats[0];
  const avgFromDb = statsRow?.avgDisplay == null ? null : Number(statsRow.avgDisplay);
  const stats = {
    total: statsRow ? Number(statsRow.totalAll) : 0,
    avgScore: avgFromDb !== null && Number.isFinite(avgFromDb) ? avgFromDb : 0,
    uniqueUsers: statsRow ? Number(statsRow.uniqueUsers) : 0,
    last24h,
  };
  return { feedbacks, total, stats };
}

export async function readPublicFeedbackPage(query: PublicFeedbackQuery): Promise<PublicFeedbackPageData> {
  const { feedbacks, total, stats } = await loadPublicFeedbackRecords(query);
  return {
    feedbacks: feedbacks.map((feedback) => ({
      id: feedback.id,
      agentId: feedback.agentId,
      clientAddress: feedback.clientAddress,
      value: feedback.value,
      tag1: feedback.tag1 || null,
      tag2: feedback.tag2 || null,
      comment: feedback.comment || null,
      createdAt: feedback.createdAt.toISOString(),
      normalized: normalizeStoredFeedbackValue(
        feedback.value,
        feedback.valueDecimals,
        feedbackSourceFromIndex(feedback.feedbackIndex, feedback.sourceRegistry),
      ),
      agent: {
        id: feedback.agent.id,
        agentId: feedback.agent.agentId,
        chainId: feedback.agent.chainId,
        name: feedback.agent.name,
        rank: feedback.agent.rank,
        chain: {
          name: feedback.agent.chain.name,
          shortName: feedback.agent.chain.shortName,
          color: feedback.agent.chain.color,
          icon: feedback.agent.chain.icon,
        },
        slug: toAgentUrlSlug(feedback.agent.name),
        profilePath: agentPublicPath(feedback.agent),
      },
    })),
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.ceil(total / query.perPage),
    stats,
    generatedAt: new Date().toISOString(),
  };
}

/** Preserves the established browser API payload while sharing the same authorised read. */
export async function readPublicFeedbackApiPage(query: PublicFeedbackQuery) {
  const { feedbacks, total, stats } = await loadPublicFeedbackRecords(query);
  return toJsonCompatible({
    feedbacks: feedbacks.map((feedback) => ({
      ...feedback,
      normalized: normalizeStoredFeedbackValue(
        feedback.value,
        feedback.valueDecimals,
        feedbackSourceFromIndex(feedback.feedbackIndex, feedback.sourceRegistry),
      ),
      agent: {
        ...feedback.agent,
        slug: toAgentUrlSlug(feedback.agent.name),
        profilePath: agentPublicPath(feedback.agent),
      },
    })),
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.ceil(total / query.perPage),
    stats,
  });
}
