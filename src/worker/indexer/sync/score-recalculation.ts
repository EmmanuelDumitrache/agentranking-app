import { prisma } from "../db.js";
import { computeAgentScoreWithSocial } from "../lib/agent-score.js";
import {
  agentScoringInputFromRow,
  computeAgentScoreLayers,
} from "../../../lib/agent-scoring-layers.js";
import { computeDiscoveryRecommendationScore } from "../../../lib/discovery-recommendation-score.js";
import { clampTrustScore } from "../lib/trust-score.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
function finite(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
type FeedbackScoreAggregate = {
  exactFeedbackCount: bigint;
  qualityScore: number | null;
  starredQualityScore: number | null;
};
export type ScoreRecalculationResult = "updated" | "unchanged" | "missing" | "raced";
/**
 * Single writer for Agent derived score/cache columns. Source ingestion only
 * mutates source facts and increments scoreStateVersion (via database triggers).
 */
export async function recalculateAgentScore(agentId: number): Promise<ScoreRecalculationResult> {
  const snapshot = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        chainId: true,
        name: true,
        description: true,
        image: true,
        x402Support: true,
        binanceCompatible: true,
        stars: true,
        lastActiveAt: true,
        activityObservedAt: true,
        sourceEvidenceType: true,
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
        walletHydrationStatus: true,
        perfWinRate: true,
        perfMonthlyPnlUsd: true,
        perfBurnToEarnRatio: true,
        perfTxCount: true,
        activeWinRate30d: true,
        nativeVolume30d: true,
        sourceFeedbackCount: true,
        sourceQualityScore: true,
        totalFeedback: true,
        scoreQuality: true,
        scoreStateVersion: true,
        scoreMaterializedVersion: true,
        metadata: {
          orderBy: [{ key: "asc" }, { id: "asc" }],
          select: { key: true, value: true },
        },
        services: {
          orderBy: [{ name: "asc" }, { endpoint: "asc" }, { id: "asc" }],
          select: { name: true, endpoint: true },
        },
      },
    });
    if (!agent) return null;
    const [storedFeedback] = await tx.$queryRaw<FeedbackScoreAggregate[]>`
      SELECT
        exact_feedback_count AS "exactFeedbackCount",
        CASE WHEN quality_score_count = 0 THEN NULL
          ELSE quality_score_sum::double precision / quality_score_count::double precision
        END AS "qualityScore",
        CASE WHEN starred_quality_score_count = 0 THEN NULL
          ELSE starred_quality_score_sum::double precision / starred_quality_score_count::double precision
        END AS "starredQualityScore"
      FROM agent_feedback_score_aggregates
      WHERE agent_id = ${agentId}
    `;
    const feedback = storedFeedback ?? {
      exactFeedbackCount: 0n,
      qualityScore: null,
      starredQualityScore: null,
    };
    const exactFeedbackCount = Number(feedback.exactFeedbackCount);
    if (!Number.isSafeInteger(exactFeedbackCount) || exactFeedbackCount < 0) {
      throw new Error("feedback count is outside the safe integer domain");
    }
    return { agent, exactFeedbackCount, feedback };
  }, { isolationLevel: "RepeatableRead" });
  if (!snapshot) return "missing";
  const { agent, exactFeedbackCount, feedback } = snapshot;
  const sourceFeedbackCount = agent.chainId === 900001 ? Math.max(0, agent.sourceFeedbackCount ?? 0) : 0;
  const totalFeedback = exactFeedbackCount + sourceFeedbackCount;
  const databaseQuality = feedback.starredQualityScore ?? feedback.qualityScore;
  const scoreQuality = Math.max(0, Math.min(100, Math.round(
    databaseQuality ?? finite(agent.sourceQualityScore, finite(agent.scoreQuality)),
  )));
  if (
    agent.scoreMaterializedVersion === agent.scoreStateVersion &&
    agent.totalFeedback === totalFeedback &&
    agent.scoreQuality === scoreQuality
  ) return "unchanged";
  const scoreWallet = agent.walletHydrationStatus === "present" ? 100 : 0;
  const activityAnchor = agent.activityObservedAt ?? (agent.sourceEvidenceType ? new Date(0) : agent.lastActiveAt);
  const { scores, social } = computeAgentScoreWithSocial({
    name: agent.name,
    description: agent.description,
    image: agent.image,
    metadata: agent.metadata,
    services: agent.services,
    scoreWallet,
    x402Support: agent.x402Support,
    binanceCompatible: agent.binanceCompatible,
    totalFeedback,
    scoreQuality,
    lastActiveAt: activityAnchor,
    isVerifiedRevenue: agent.isVerifiedRevenue,
    perfWinRate: agent.perfWinRate,
    perfMonthlyPnlUsd: agent.perfMonthlyPnlUsd,
    perfBurnToEarnRatio: agent.perfBurnToEarnRatio,
  });
  const scoringInput = agentScoringInputFromRow({
    ...agent,
    metadata: agent.metadata,
    services: agent.services,
    totalFeedback,
    scoreWallet,
    scoreQuality,
    scoreMetadata: scores.scoreMetadata,
    scoreServices: scores.scoreEndpoints,
    scoreSocial: scores.scoreSocial,
    scoreFreshness: scores.scoreFreshness,
    scorePopularity: scores.scorePopularity,
    hotScore: scores.hotScore,
    socialSignals: social,
    scoreDimensionsAuthoritative: true,
  });
  const layers = computeAgentScoreLayers(scoringInput);
  const executionScore = layers.protocolTrust.executionScore ?? 0;
  const discoveryScore = computeDiscoveryRecommendationScore({
    ...scoringInput,
    agentRankScore: layers.agentRankScore,
    activityScore: layers.activity.score,
    protocolTrustScore: layers.protocolTrust.score,
  });
  const scoreActivity = totalFeedback > 0
    ? Math.min(100, Math.round(Math.log2(totalFeedback + 1) * 12))
    : 0;
  const update = await withSerializableRetry(() => prisma.agent.updateMany({
    where: { id: agentId, scoreStateVersion: agent.scoreStateVersion },
    data: {
      totalFeedback,
      scoreWallet,
      scoreQuality,
      scoreActivity,
      score: clampTrustScore(layers.profile.score),
      hotScore: clampTrustScore(scores.hotScore),
      protocolTrustScore: clampTrustScore(layers.protocolTrust.score),
      executionScore: clampTrustScore(executionScore),
      activityScore: clampTrustScore(layers.activity.score),
      agentRankScore: clampTrustScore(layers.agentRankScore),
      discoveryScore: clampTrustScore(discoveryScore),
      scoreMetadata: scores.scoreMetadata,
      scoreServices: scores.scoreEndpoints,
      scoreSocial: scores.scoreSocial,
      scoreCompliance: scores.scoreCompliance,
      scoreFreshness: scores.scoreFreshness,
      scorePopularity: scores.scorePopularity,
      scoreVerifiedRevenue: scores.scoreVerifiedRevenue,
      scoreMaterializedVersion: agent.scoreStateVersion,
      scoreRecalculatedAt: new Date(),
    },
  }));
  return update.count === 1 ? "updated" : "raced";
}
export async function findStaleScoreAgentIds(afterAgentId = 0, take = 250): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id
    FROM "Agent"
    WHERE id > ${afterAgentId}
      AND "score_state_version" > "score_materialized_version"
    ORDER BY id ASC
    LIMIT ${take}
  `;
  return rows.map((row) => row.id);
}
export async function hasStaleScoreAgents(): Promise<boolean> {
  const [row] = await prisma.$queryRaw<Array<{ stale: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "Agent"
      WHERE "score_state_version" > "score_materialized_version"
      LIMIT 1
    ) AS stale
  `;
  return row?.stale ?? false;
}
