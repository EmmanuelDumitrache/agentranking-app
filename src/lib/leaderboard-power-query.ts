import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import {
  LEADERBOARD_AGENTS_ORDER_BY,
  leaderboardAgentsWhereAllTime,
  leaderboardAgentsWhereWithActivityWindow,
} from "@/lib/leaderboard-filters";
/**
 * Same cohort and ordering as GET /api/powerboost (period=all when `activitySince` omitted).
 * DAO ticker uses this so the strip matches DAO votes.
 */
export async function findPowerRankingAgents<T extends Prisma.AgentSelect>(
  db: PrismaClient,
  options: { select: T; take: number; skip?: number; activitySince?: Date }
): Promise<Prisma.AgentGetPayload<{ select: T }>[]> {
  const whereBase = options.activitySince
    ? leaderboardAgentsWhereWithActivityWindow(options.activitySince)
    : leaderboardAgentsWhereAllTime();
  const where = await extendAgentWhereIndexable(whereBase);
  return db.agent.findMany({
    where,
    select: options.select,
    orderBy: LEADERBOARD_AGENTS_ORDER_BY,
    skip: options.skip ?? 0,
    take: options.take,
  });
}
