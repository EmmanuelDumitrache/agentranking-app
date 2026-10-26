/**
 * Canonical scoring fields for API list + detail responses.
 */
import {
  buildScoreBreakdown,
  computeAgentScoreLayers,
  computeFinalRankScore,
  computeMonetizationScore,
  computeReputationScore,
  agentScoringInputFromRow,
  SCORE_VERSION,
  type AgentScoringInput,
  type RankConfidenceBand,
} from "@/lib/agent-scoring-layers";
export type ScoreBreakdownPayload = ReturnType<typeof buildScoreBreakdown>;
export type AgentScoringPayload = {
  /** Primary public composite (30/30/25/15). */
  agentRankScore: number;
  profileScore: number;
  protocolTrustScore: number;
  reputationScore: number;
  activityScore: number;
  monetizationScore: number;
  organicRank: number;
  scoreVersion: number;
  rankConfidence: RankConfidenceBand;
  confidenceSummary: string;
  scoreBreakdown: ScoreBreakdownPayload;
};
export function attachAgentScoringPayload(
  row: AgentScoringInput & {
    rank?: number | null;
    score?: number | null;
    protocolTrustScore?: number | null;
    agentRankScore?: number | null;
    activityScore?: number | null;
    executionScore?: number | null;
  },
  options?: { powerRank?: number | null },
): AgentScoringPayload & { powerRank?: number } {
  const input = agentScoringInputFromRow(row);
  const layers = computeAgentScoreLayers(input);
  const organicRank = Math.max(0, Number(row.rank ?? 0));
  const profileScore = row.score != null && row.score > 0 ? row.score : layers.profile.score;
  const protocolTrustScore =
    row.protocolTrustScore != null && row.protocolTrustScore > 0 ? row.protocolTrustScore : layers.protocolTrust.score;
  const activityScore =
    row.activityScore != null && row.activityScore > 0
      ? row.activityScore
      : layers.activity.score;
  const agentRankScore =
    row.agentRankScore != null && row.agentRankScore > 0
      ? row.agentRankScore
      : layers.agentRankScore;
  const monetizationScore = layers.monetization.score;
  const payload: AgentScoringPayload & { powerRank?: number } = {
    agentRankScore,
    profileScore,
    protocolTrustScore,
    reputationScore: layers.reputation.score,
    activityScore,
    monetizationScore,
    organicRank,
    scoreVersion: SCORE_VERSION,
    rankConfidence: layers.rankConfidence,
    confidenceSummary: layers.confidenceSummary,
    scoreBreakdown: buildScoreBreakdown(layers),
  };
  if (options?.powerRank != null && options.powerRank > 0) {
    payload.powerRank = options.powerRank;
  }
  return payload;
}
/** Lightweight scoring fields when full layer recompute is skipped (list hot paths). */
export function attachAgentScoringPayloadFromStored(row: {
  score?: number | null;
  protocolTrustScore?: number | null;
  agentRankScore?: number | null;
  activityScore?: number | null;
  rank?: number | null;
  reputationScore?: number | null;
  monetizationScore?: number | null;
  totalFeedback?: number | null;
  stars?: number | null;
  scoreQuality?: number | null;
  x402Support?: boolean;
  services?: Array<{ name: string; endpoint: string }>;
  isVerifiedRevenue?: boolean;
  binanceCompatible?: boolean;
}): Pick<
  AgentScoringPayload,
  | "agentRankScore"
  | "profileScore"
  | "protocolTrustScore"
  | "reputationScore"
  | "activityScore"
  | "monetizationScore"
  | "organicRank"
> {
  const profileScore = Math.round(row.score ?? 0);
  const protocolTrustScore = Math.round(row.protocolTrustScore ?? 0);
  const agentRankScore = Math.round(row.agentRankScore ?? 0);
  const activityScore = Math.round(row.activityScore ?? 0);
  const monetizationScore =
    row.monetizationScore != null
      ? Math.round(row.monetizationScore)
      : computeMonetizationScore({
          name: "",
          description: "",
          image: "",
          metadata: [],
          services: row.services ?? [],
          scoreWallet: 0,
          x402Support: row.x402Support ?? false,
          binanceCompatible: row.binanceCompatible ?? false,
          totalFeedback: 0,
          stars: 0,
          scoreQuality: 0,
          lastActiveAt: new Date(),
          isVerifiedRevenue: row.isVerifiedRevenue,
        }).score;
  const reputationScore =
    row.reputationScore != null && row.reputationScore > 0
      ? Math.round(row.reputationScore)
      : computeReputationScore({
          name: "",
          description: "",
          image: "",
          metadata: [],
          services: row.services ?? [],
          scoreWallet: 0,
          x402Support: row.x402Support ?? false,
          binanceCompatible: row.binanceCompatible ?? false,
          totalFeedback: row.totalFeedback ?? 0,
          stars: row.stars ?? 0,
          scoreQuality: row.scoreQuality ?? 0,
          lastActiveAt: new Date(),
        }).score;
  const compositeFromLayers =
    agentRankScore > 0
      ? agentRankScore
      : computeFinalRankScore({
          profile: profileScore,
          protocolTrust: protocolTrustScore,
          reputation: reputationScore,
          activity: activityScore,
        });
  return {
    agentRankScore: compositeFromLayers,
    profileScore,
    protocolTrustScore,
    reputationScore,
    activityScore,
    monetizationScore,
    organicRank: Math.max(0, Number(row.rank ?? 0)),
  };
}
