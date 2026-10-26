import type { PrismaClient } from "@/generated/prisma/client";
import { computeAgentScore } from "./agent-score";
import { persistAgentScoresById } from "./persist-agent-scores";
const BATCH = 200;
/** Recompute dimension columns + layer scores for every agent from DB state. */
export async function recomputeAllAgentScores(prisma: PrismaClient): Promise<number> {
  let updated = 0;
  let skip = 0;
  for (;;) {
    const agents = await prisma.agent.findMany({
      orderBy: { id: "asc" },
      skip,
      take: BATCH,
      include: { metadata: true, services: true },
    });
    if (agents.length === 0) break;
    for (const a of agents) {
      const r = computeAgentScore({
        name: a.name,
        description: a.description,
        image: a.image,
        metadata: a.metadata,
        services: a.services.map((s) => ({ name: s.name, endpoint: s.endpoint })),
        scoreWallet: a.scoreWallet,
        x402Support: a.x402Support,
        binanceCompatible: a.binanceCompatible,
        totalFeedback: a.totalFeedback,
        scoreQuality: a.scoreQuality ?? 0,
        lastActiveAt: a.lastActiveAt,
        isVerifiedRevenue: a.isVerifiedRevenue,
        perfWinRate: a.perfWinRate,
        perfMonthlyPnlUsd: a.perfMonthlyPnlUsd,
        perfBurnToEarnRatio: a.perfBurnToEarnRatio,
      });
      await prisma.agent.update({
        where: { id: a.id },
        data: {
          hotScore: r.hotScore,
          scoreMetadata: r.scoreMetadata,
          scoreServices: r.scoreEndpoints,
          scoreFreshness: r.scoreFreshness,
          scorePopularity: r.scorePopularity,
        },
        select: { id: true },
      });
      await persistAgentScoresById(prisma, a.id);
      updated++;
    }
    skip += BATCH;
  }
  return updated;
}