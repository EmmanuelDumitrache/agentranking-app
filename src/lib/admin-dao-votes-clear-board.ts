import type { PrismaClient } from "@/generated/prisma/client";
import { invalidatePublicDaoVotesCaches } from "@/lib/admin-dao-votes";
import { upsertDaoVotesLiveForAgents } from "@/lib/dao-votes-store";
import {
  pruneDaoLeaderboardLiveToBoard,
  syncAllAgentListingPowerBatched,
} from "@/lib/sync-agent-power-scores";
export type ClearDaoBoardResult = {
  adminAdjustmentsCleared: number;
  agentsOnBoardBefore: number;
  agentsOnBoardAfter: number;
};
/**
 * Reset admin DAO adjustments, recompute every agent's listing power from paid boosts +
 * holder perks + admin (now 0), refresh DaoLeaderboardLive, and bust public caches.
 *
 * Agents with real paid boosts or active holder power perks remain on the board.
 */
export async function clearDaoVotesBoard(db: PrismaClient): Promise<ClearDaoBoardResult> {
  const boardWhere = {
    isActive: true,
    agentId: { not: 88888 },
    powerScore: { gt: 0 },
  } as const;
  const agentsOnBoardBefore = await db.agent.count({ where: boardWhere });
  const cleared = await db.agent.updateMany({
    where: {
      agentId: { not: 88888 },
      OR: [{ powerScore: { gt: 0 } }, { adminPowerAdjust: { not: 0 } }],
    },
    data: { adminPowerAdjust: 0 },
  });
  await syncAllAgentListingPowerBatched(db, {
    onBatch: (fromId, toId) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`[clear-dao-board] power sync ids ${fromId}–${toId}`);
      }
    },
  });
  const liveBatch = 5_000;
  let liveCursor = 0;
  for (;;) {
    const rows = await db.agent.findMany({
      where: {
        isActive: true,
        agentId: { not: 88888 },
        powerScore: { gt: 0 },
        id: { gt: liveCursor },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: liveBatch,
    });
    if (rows.length === 0) break;
    liveCursor = rows[rows.length - 1]!.id;
    await upsertDaoVotesLiveForAgents(
      db,
      rows.map((r) => r.id),
    );
  }
  await pruneDaoLeaderboardLiveToBoard(db);
  await invalidatePublicDaoVotesCaches();
  const agentsOnBoardAfter = await db.agent.count({ where: boardWhere });
  return {
    adminAdjustmentsCleared: cleared.count,
    agentsOnBoardBefore,
    agentsOnBoardAfter,
  };
}
