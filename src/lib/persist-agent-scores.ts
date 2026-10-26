/**
 * Shared score-layer writer for request/admin paths. The indexer score materializer writes
 * the same layer model per Agent; global organic rank is published separately and event-driven.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
type PrismaDb = PrismaClient | Prisma.TransactionClient;
import {
  agentScoringInputFromRow,
  computeAgentScoreLayers,
  type AgentScoringInput,
} from "@/lib/agent-scoring-layers";
export type PersistAgentScoresResult = {
  profileScore: number;
  protocolTrustScore: number;
  reputationScore: number;
  activityScore: number;
  agentRankScore: number;
  executionScore: number;
};
/** Compute layers and return Prisma update payload (no DB write). */
export function buildAgentScoreUpdate(
  input: AgentScoringInput,
  options?: { includeFinalRank?: boolean },
): {
  data: Prisma.AgentUpdateManyMutationInput;
  layers: ReturnType<typeof computeAgentScoreLayers>;
} {
  const layers = computeAgentScoreLayers(input);
  const executionScore = layers.protocolTrust.executionScore ?? 0;
  const data: Prisma.AgentUpdateManyMutationInput = {
    score: layers.profile.score,
    protocolTrustScore: layers.protocolTrust.score,
    executionScore: executionScore,
    activityScore: layers.activity.score,
    ...(options?.includeFinalRank ? { agentRankScore: layers.agentRankScore } : {}),
  };
  return { data, layers };
}
/** Persist profile, protocol trust, execution, activity, and composite ranking scores. */
export async function persistAgentScores(
  prisma: PrismaDb,
  agentId: number,
  input: AgentScoringInput,
  options?: { includeFinalRank?: boolean },
): Promise<PersistAgentScoresResult> {
  const { data, layers } = buildAgentScoreUpdate(input, options);
  const executionScore = layers.protocolTrust.executionScore ?? 0;
  const changedScore: Prisma.AgentWhereInput[] = [
    { score: { not: layers.profile.score } },
    { protocolTrustScore: { not: layers.protocolTrust.score } },
    { executionScore: { not: executionScore } },
    { activityScore: { not: layers.activity.score } },
    ...(options?.includeFinalRank
      ? [{ agentRankScore: { not: layers.agentRankScore } } satisfies Prisma.AgentWhereInput]
      : []),
  ];
  // Stable indexer projections call this writer repeatedly. Keep the read-side
  // scoring contract, but avoid a heap version, WAL record, and invalidation
  // trigger when every deterministic score is already materialized.
  await prisma.agent.updateMany({
    where: { id: agentId, OR: changedScore },
    data,
  });
  return {
    profileScore: layers.profile.score,
    protocolTrustScore: layers.protocolTrust.score,
    reputationScore: layers.reputation.score,
    activityScore: layers.activity.score,
    agentRankScore: layers.agentRankScore,
    executionScore,
  };
}
/** Load agent row fields needed for scoring and persist. */
export async function persistAgentScoresById(
  prisma: PrismaDb,
  agentId: number,
  options?: { includeFinalRank?: boolean },
): Promise<PersistAgentScoresResult | null> {
  const row = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      description: true,
      image: true,
      scoreWallet: true,
      x402Support: true,
      binanceCompatible: true,
      totalFeedback: true,
      stars: true,
      scoreQuality: true,
      scoreMetadata: true,
      scoreServices: true,
      scoreFreshness: true,
      scorePopularity: true,
      hotScore: true,
      lastActiveAt: true,
      sapLastSyncedAt: true,
      isVerified: true,
      isPremiumVerified: true,
      sapVerified: true,
      sapProtocols: true,
      sapStats: true,
      sapReputationScore: true,
      hasDuplicateName: true,
      voteFireCount: true,
      votePooCount: true,
      isVerifiedRevenue: true,
      verifiedWallet: true,
      perfWinRate: true,
      perfMonthlyPnlUsd: true,
      perfBurnToEarnRatio: true,
      perfTxCount: true,
      activeWinRate30d: true,
      nativeVolume30d: true,
      metadata: { select: { key: true, value: true } },
      services: { select: { name: true, endpoint: true } },
    },
  });
  if (!row) return null;
  const input = agentScoringInputFromRow(row);
  return persistAgentScores(prisma, agentId, input, options);
}
