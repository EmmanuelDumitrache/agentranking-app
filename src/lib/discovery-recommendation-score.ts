/**
 * Homepage Recommended sort score (discoveryRecommendationScore) — persisted as Agent.discoveryScore.
 * Separate from AR composite (agentRankScore) and organic rank.
 */
import {
  agentScoringInputFromRow,
  computeAgentScoreLayers,
  deriveAgentServiceSignals,
  type AgentServiceSignals,
} from "@/lib/agent-scoring-layers";
import { reviewEngagementNorm } from "@/lib/recommended-agent-ranking";
const PENALTY_CAP = 35;
export type DiscoveryRecommendationInput = {
  name: string;
  description?: string | null;
  image?: string | null;
  metadata?: Array<{ key: string; value: string }>;
  services?: Array<{ name: string; endpoint?: string | null }>;
  serviceSignals?: AgentServiceSignals;
  score?: number | null;
  scoreMetadata?: number | null;
  scoreServices?: number | null;
  scoreFreshness?: number | null;
  scoreQuality?: number | null;
  scoreDimensionsAuthoritative?: boolean;
  activityScore?: number | null;
  agentRankScore?: number | null;
  protocolTrustScore?: number | null;
  totalFeedback?: number | null;
  stars?: number | null;
  x402Support?: boolean | null;
  binanceCompatible?: boolean | null;
  isVerified?: boolean | null;
  isPremiumVerified?: boolean | null;
  sapVerified?: boolean | null;
  sapTwinMatch?: boolean | null;
  hasDuplicateName?: boolean | null;
  archetype?: string | null;
  archetypeAuto?: boolean | string | null;
  scoreWallet?: number | null;
  lastActiveAt?: Date | string | null;
};
function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function agentRankNorm(input: DiscoveryRecommendationInput): number {
  const ps = input.agentRankScore;
  if (ps != null && (input.scoreDimensionsAuthoritative === true || ps > 0)) return clampScore(ps);
  const layers = computeAgentScoreLayers(agentScoringInputFromRow(input as Parameters<typeof agentScoringInputFromRow>[0]));
  return clampScore(layers.agentRankScore);
}
function activityNorm(input: DiscoveryRecommendationInput): number {
  const t = input.activityScore;
  if (t != null && (input.scoreDimensionsAuthoritative === true || t > 0)) return clampScore(t);
  const f = input.scoreFreshness;
  if (f != null && (input.scoreDimensionsAuthoritative === true || f > 0)) return clampScore(f);
  const layers = computeAgentScoreLayers(agentScoringInputFromRow(input as Parameters<typeof agentScoringInputFromRow>[0]));
  return clampScore(layers.activity.score);
}
function verificationNorm(input: DiscoveryRecommendationInput): number {
  let pts = 0;
  if (input.isPremiumVerified) pts += 55;
  else if (input.isVerified) pts += 40;
  if (input.sapVerified || input.sapTwinMatch) pts += 15;
  const protocol = clampScore(input.protocolTrustScore ?? 0);
  pts += Math.round(protocol * 0.35);
  return clampScore(pts);
}
function capabilitiesNorm(input: DiscoveryRecommendationInput): number {
  let pts = 0;
  if (input.sapVerified || input.sapTwinMatch) pts += 35;
  if (input.x402Support) pts += 25;
  const serviceSignals = input.serviceSignals ?? deriveAgentServiceSignals(input.services ?? []);
  if (serviceSignals.mcp) pts += 20;
  const dim = input.scoreServices ?? 0;
  if (dim > 0) pts = Math.max(pts, Math.round(dim * 0.6));
  else if (serviceSignals.hasEndpoint) pts += 15;
  return clampScore(pts);
}
function protocolRelevanceNorm(input: DiscoveryRecommendationInput): number {
  if (input.sapVerified || input.sapTwinMatch) return 90;
  if (input.x402Support) return 75;
  const serviceSignals = input.serviceSignals ?? deriveAgentServiceSignals(input.services ?? []);
  if (serviceSignals.mcp) return 70;
  if (serviceSignals.a2aRelated) return 65;
  const arch = (input.archetype ?? "").trim();
  if (arch || input.archetypeAuto === true || (typeof input.archetypeAuto === "string" && input.archetypeAuto.trim())) {
    return 55;
  }
  return 40;
}
function computePenalties(input: DiscoveryRecommendationInput): number {
  let total = 0;
  const meta = input.scoreMetadata ?? 0;
  const desc = (input.description ?? "").trim();
  const img = (input.image ?? "").trim();
  const hasMetaRows = (input.metadata ?? []).length > 0;
  if (meta < 25 || (!desc && !img && !hasMetaRows)) {
    total += 12;
  }
  const serviceSignals = input.serviceSignals ?? deriveAgentServiceSignals(input.services ?? []);
  if (!serviceSignals.hasEndpoint && (input.scoreServices ?? 0) < 20) {
    total += 14;
  }
  if (input.hasDuplicateName) {
    total += 16;
  }
  if ((input.scoreServices ?? 0) < 15 && !(serviceSignals.mcp || serviceSignals.a2a || serviceSignals.web)) {
    total += 8;
  }
  return Math.min(PENALTY_CAP, total);
}
export function computeDiscoveryRecommendationScore(input: DiscoveryRecommendationInput): number {
  const normalized = input.serviceSignals
    ? input
    : { ...input, serviceSignals: deriveAgentServiceSignals(input.services ?? []) };
  const base =
    agentRankNorm(normalized) * 0.3 +
    reviewEngagementNorm(normalized.totalFeedback) * 0.2 +
    activityNorm(normalized) * 0.15 +
    verificationNorm(normalized) * 0.15 +
    capabilitiesNorm(normalized) * 0.1 +
    protocolRelevanceNorm(normalized) * 0.1;
  return clampScore(base - computePenalties(normalized));
}
