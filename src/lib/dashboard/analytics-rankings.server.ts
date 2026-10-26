import "server-only";
import { prisma } from "@/lib/db";
export const DASHBOARD_RANKINGS_PAGE_SIZE = 10;

export type DashboardRankingsScope = "mine" | "all";

export type DashboardRankedAgentDto = {
  id: number;
  name: string;
  image: string;
  owner: string;
  agentRankScore: number;
  isVerified: boolean;
  isPremiumVerified: boolean;
  chain: { shortName: string; icon: string };
};
export type DashboardRankingsDto = {
  agents: DashboardRankedAgentDto[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  averageAgentRankScore: number;
  verifiedCount: number;
  scope: DashboardRankingsScope;
  viewStats: {
    totalViews: number;
    daily: Array<{ date: string; views: number }>;
  };
};
function normalizePage(rawPage: string | undefined, totalPages: number): number {
  const parsed = Number.parseInt(rawPage ?? "1", 10);
  const requested = Number.isFinite(parsed) ? parsed : 1;
  return Math.max(1, Math.min(Math.max(totalPages, 1), requested));
}

function normalizeScope(raw: string | undefined): DashboardRankingsScope {
  return raw?.trim().toLowerCase() === "all" ? "all" : "mine";
}

export async function loadDashboardRankings(
  agentId: number,
  rawPage?: string,
  options?: {
    readonly ownedAgentIds?: readonly number[];
    readonly scope?: string;
  },
): Promise<DashboardRankingsDto> {
  const scope = normalizeScope(options?.scope);
  const ownedAgentIds = (options?.ownedAgentIds ?? []).filter((id) => Number.isSafeInteger(id) && id > 0);
  const agentWhere =
    scope === "mine"
      ? {
          isActive: true as const,
          id: { in: ownedAgentIds.length > 0 ? [...ownedAgentIds] : [-1] },
        }
      : { isActive: true as const };

  const now = new Date();
  const since = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);
  const [totalCount, scoreAggregate, verifiedCount, totalViewsAggregate, daily] =
    await Promise.all([
      prisma.agent.count({ where: agentWhere }),
      prisma.agent.aggregate({
        where: agentWhere,
        _avg: { agentRankScore: true },
      }),
      prisma.agent.count({
        where: {
          ...agentWhere,
          OR: [{ isVerified: true }, { isPremiumVerified: true }],
        },
      }),
      prisma.agentAnalyticsDaily.aggregate({
        where: { agentId },
        _sum: { profileViews: true },
      }),
      prisma.agentAnalyticsDaily.findMany({
        where: { agentId, date: { gte: since } },
        select: { date: true, profileViews: true },
        orderBy: { date: "asc" },
      }),
    ]);
  const totalPages = Math.ceil(totalCount / DASHBOARD_RANKINGS_PAGE_SIZE);
  const currentPage = normalizePage(rawPage, totalPages);
  const agents = await prisma.agent.findMany({
    where: agentWhere,
    select: {
      id: true,
      name: true,
      image: true,
      owner: true,
      agentRankScore: true,
      isVerified: true,
      isPremiumVerified: true,
      chain: { select: { shortName: true, icon: true } },
    },
    orderBy: [{ agentRankScore: "desc" }, { id: "asc" }],
    skip: (currentPage - 1) * DASHBOARD_RANKINGS_PAGE_SIZE,
    take: DASHBOARD_RANKINGS_PAGE_SIZE,
  });
  const byDay = new Map<string, number>();
  for (const row of daily) {
    const key = row.date.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + row.profileViews);
  }
  const dailyViews: Array<{ date: string; views: number }> = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = day.toISOString().slice(0, 10);
    dailyViews.push({ date: key, views: byDay.get(key) ?? 0 });
  }
  return {
    agents,
    totalCount,
    totalPages,
    currentPage,
    averageAgentRankScore: Math.round(scoreAggregate._avg.agentRankScore ?? 0),
    verifiedCount,
    scope,
    viewStats: {
      totalViews: totalViewsAggregate._sum.profileViews ?? 0,
      daily: dailyViews,
    },
  };
}
