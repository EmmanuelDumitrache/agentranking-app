/**
 * Product-facing scoring layers (Profile, Protocol Trust, Reputation, Activity, Final Rank).
 * Persisted via Agent.score, protocolTrustScore, activityScore, agentRankScore — see persist-agent-scores.ts.
 */
import {
  computeExecutionScore,
  computeSocialScore,
  scoreComplianceDimension,
  scoreEndpointsDimension,
  scoreMetadataDimension,
  type ComputeExecutionScoreInput,
} from "@/lib/agent-score";
import { reviewEngagementNorm } from "@/lib/recommended-agent-ranking";
import { covenantScoreContribution } from "@/lib/covenant/score-reasons";
import { parseCovenantVerificationSnapshot } from "@/lib/covenant/snapshot";
import { isCovenantAgent } from "@/lib/covenant/detect";
export const SCORE_VERSION = 1;
export const FINAL_RANK_WEIGHTS = {
  profile: 0.3,
  protocolTrust: 0.3,
  reputation: 0.25,
  activity: 0.15,
} as const;
export type RankConfidenceBand = "Low" | "Medium" | "High" | "Verified";
export type LayerScoreResult = {
  score: number;
  reasons: string[];
};
export type ProtocolTrustResult = LayerScoreResult & {
  executionNote?: string;
  executionScore?: number;
};
export type AgentServiceSignals = {
  endpointCount: number;
  hasEndpoint: boolean;
  mcp: boolean;
  a2a: boolean;
  a2aRelated: boolean;
  web: boolean;
};
export function deriveAgentServiceSignals(
  services: readonly { name: string; endpoint?: string | null }[],
): AgentServiceSignals {
  let endpointCount = 0;
  let mcp = false;
  let a2a = false;
  let a2aRelated = false;
  let web = false;
  for (const service of services) {
    if (service.endpoint?.trim()) endpointCount += 1;
    const name = service.name.toUpperCase();
    if (name === "MCP") mcp = true;
    if (name === "A2A") a2a = true;
    if (name.includes("A2A")) a2aRelated = true;
    if (name === "WEB") web = true;
  }
  return { endpointCount, hasEndpoint: endpointCount > 0, mcp, a2a, a2aRelated, web };
}
export type AgentScoringInput = {
  name: string;
  description: string;
  image: string;
  metadata: Array<{ key: string; value: string }>;
  services: Array<{ name: string; endpoint: string }>;
  scoreWallet: number;
  x402Support: boolean;
  binanceCompatible: boolean;
  totalFeedback: number;
  stars: number;
  scoreQuality: number;
  scoreMetadata?: number;
  scoreServices?: number;
  scoreSocial?: number;
  scoreFreshness?: number;
  scorePopularity?: number;
  hotScore?: number;
  socialSignals?: ReturnType<typeof computeSocialScore>;
  scoreDimensionsAuthoritative?: boolean;
  serviceSignals?: AgentServiceSignals;
  lastActiveAt: Date | string;
  sapLastSyncedAt?: Date | string | null;
  isVerified?: boolean;
  isPremiumVerified?: boolean;
  sapVerified?: boolean;
  sapProtocols?: string[];
  sapStats?: unknown;
  sapReputationScore?: number | null;
  hasDuplicateName?: boolean;
  voteFireCount?: number;
  votePooCount?: number;
  isVerifiedRevenue?: boolean;
  verifiedWallet?: string | null;
  perfWinRate?: number | null;
  perfMonthlyPnlUsd?: number | null;
  perfBurnToEarnRatio?: number | null;
  perfTxCount?: number | null;
  activeWinRate30d?: number | null;
  nativeVolume30d?: number | null;
};
export type AgentScoreLayers = {
  profile: LayerScoreResult;
  protocolTrust: ProtocolTrustResult;
  reputation: LayerScoreResult;
  activity: LayerScoreResult;
  monetization: LayerScoreResult;
  agentRankScore: number;
  rankConfidence: RankConfidenceBand;
  confidenceSummary: string;
};
const PROFILE_WEIGHTS = {
  metadata: 0.28,
  endpoints: 0.26,
  social: 0.14,
  compliance: 0.14,
  freshness: 0.18,
} as const;
function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function parseSapReputation(stats: unknown): number {
  if (stats == null || typeof stats !== "object") return 0;
  const raw = (stats as Record<string, unknown>).identityReputationScore;
  if (typeof raw === "number" && Number.isFinite(raw)) return clampScore(raw);
  return 0;
}
function hoursSince(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (60 * 60 * 1000);
}
function freshnessPts(lastActiveAt: Date | string): number {
  const h = hoursSince(lastActiveAt);
  if (h == null) return 0;
  if (h <= 24) return 92;
  if (h <= 72) return 78;
  if (h <= 168) return 62;
  if (h <= 720) return 38;
  if (h <= 2160) return 12;
  return 0;
}
export function computeProfileScore(input: AgentScoringInput): LayerScoreResult {
  const metadata = input.metadata ?? [];
  const services = input.services ?? [];
  const serviceSignals = input.serviceSignals ?? deriveAgentServiceSignals(services);
  const reasons: string[] = [];
  const authoritative = input.scoreDimensionsAuthoritative === true;
  const scoreMetadata =
    input.scoreMetadata != null && (authoritative || input.scoreMetadata > 0)
      ? input.scoreMetadata
      : scoreMetadataDimension(input.name, input.description, input.image, metadata);
  const scoreEndpoints =
    input.scoreServices != null && (authoritative || input.scoreServices > 0)
      ? Math.min(100, input.scoreServices)
      : scoreEndpointsDimension(services);
  const social = input.socialSignals ?? computeSocialScore(metadata, services);
  const scoreSocial = input.scoreSocial != null && (authoritative || input.scoreSocial > 0)
    ? input.scoreSocial
    : social.score;
  const scoreCompliance = scoreComplianceDimension(
    input.scoreWallet,
    input.x402Support,
    input.binanceCompatible,
  );
  const lastActive =
    input.lastActiveAt instanceof Date ? input.lastActiveAt : new Date(input.lastActiveAt);
  const scoreFreshness =
    input.scoreFreshness != null && (authoritative || input.scoreFreshness > 0)
      ? input.scoreFreshness
      : freshnessPts(lastActive);
  if (scoreMetadata >= 50) reasons.push("Strong metadata");
  else if (scoreMetadata >= 20) reasons.push("Basic metadata present");
  if (scoreEndpoints >= 40) reasons.push("Valid service endpoints");
  if (input.x402Support) reasons.push("x402 payable");
  if (serviceSignals.mcp) reasons.push("MCP endpoint listed");
  if (serviceSignals.a2a) reasons.push("A2A endpoint listed");
  if (social.website) reasons.push("Website or URI linked");
  if (social.twitter || social.github) reasons.push("Social links present");
  if (scoreFreshness >= 60) reasons.push("Recently active listing");
  const w = PROFILE_WEIGHTS;
  const score = clampScore(
    scoreMetadata * w.metadata +
      scoreEndpoints * w.endpoints +
      scoreSocial * w.social +
      scoreCompliance * w.compliance +
      scoreFreshness * w.freshness,
  );
  return { score, reasons: reasons.slice(0, 6) };
}
export function computeProtocolTrustScore(input: AgentScoringInput): ProtocolTrustResult {
  const reasons: string[] = [];
  let pts = 0;
  if (input.isPremiumVerified) {
    pts += 35;
    reasons.push("Premium verified listing");
  } else if (input.isVerified) {
    pts += 22;
    reasons.push("KYA verified");
  }
  if (input.sapVerified) {
    pts += 18;
    reasons.push("SAP on-chain registration");
  }
  if (isCovenantAgent(input.sapProtocols)) {
    const covenantSnap = parseCovenantVerificationSnapshot(input.metadata);
    const cov = covenantScoreContribution({
      sapProtocols: input.sapProtocols,
      snapshot: covenantSnap,
    });
    if (cov.points > 0) {
      pts += cov.points;
      for (const r of cov.reasons) {
        if (!reasons.includes(r)) reasons.push(r);
      }
    }
  }
  const sapRep =
    typeof input.sapReputationScore === "number" && Number.isFinite(input.sapReputationScore)
      ? clampScore(input.sapReputationScore)
      : parseSapReputation(input.sapStats);
  if (sapRep > 0) {
    pts += Math.round(sapRep * 0.25);
    if (sapRep >= 50) reasons.push("SAP reputation signal");
  }
  if (input.scoreWallet > 0) {
    pts += 10;
    reasons.push("Registry wallet on file");
  }
  const executionInput: ComputeExecutionScoreInput = {
    isVerifiedRevenue: input.isVerifiedRevenue,
    perfWinRate: input.perfWinRate,
    perfMonthlyPnlUsd: input.perfMonthlyPnlUsd,
    perfBurnToEarnRatio: input.perfBurnToEarnRatio,
    activeWinRate30d: input.activeWinRate30d,
    nativeVolume30d: input.nativeVolume30d,
    verifiedWallet: input.verifiedWallet,
    scoreWallet: input.scoreWallet,
    perfTxCount: input.perfTxCount,
    metadata: input.metadata,
  };
  const executionScore = computeExecutionScore(executionInput);
  pts += Math.round(executionScore * 0.35);
  let executionNote: string | undefined;
  if (input.verifiedWallet?.trim()) {
    executionNote = "Linked execution wallet";
    reasons.push("Execution wallet linked");
  } else if (executionScore >= 30) {
    executionNote = "On-chain activity signals detected";
    reasons.push("On-chain activity signals");
  }
  if (input.hasDuplicateName) {
    pts = Math.max(0, pts - 15);
    reasons.push("Possible duplicate identity");
  }
  const score = clampScore(pts);
  return {
    score,
    reasons: reasons.slice(0, 6),
    executionNote,
    executionScore,
  };
}
export function computeReputationScore(input: AgentScoringInput): LayerScoreResult {
  const reasons: string[] = [];
  const fb = Math.max(0, input.totalFeedback ?? 0);
  const reviewNorm = reviewEngagementNorm(fb);
  const quality = Math.min(100, input.scoreQuality ?? 0);
  const stars = Math.max(0, input.stars ?? 0);
  const starPts = Math.min(20, stars * 2);
  const fire = Math.min(15, (input.voteFireCount ?? 0) * 2);
  const poo = Math.min(10, (input.votePooCount ?? 0));
  const votePts = Math.max(0, fire - poo);
  if (fb > 0) reasons.push(`${fb} review${fb === 1 ? "" : "s"}`);
  if (quality >= 50) reasons.push("Positive feedback quality");
  if (stars > 0) reasons.push("Community stars");
  if (votePts > 5) reasons.push("Community vote signal");
  const score = clampScore(reviewNorm * 0.55 + quality * 0.25 + starPts + votePts);
  return { score, reasons: reasons.slice(0, 5) };
}
/** Display-only monetization signals (not in FINAL_RANK_WEIGHTS). */
export function computeMonetizationScore(input: AgentScoringInput): LayerScoreResult {
  const reasons: string[] = [];
  const services = input.services ?? [];
  const serviceSignals = input.serviceSignals ?? deriveAgentServiceSignals(services);
  let pts = 0;
  if (input.x402Support) {
    pts += 35;
    reasons.push("x402 payable");
  }
  if (serviceSignals.mcp) {
    pts += 25;
    reasons.push("MCP endpoint listed");
  }
  if (serviceSignals.a2a) {
    pts += 15;
    reasons.push("A2A endpoint listed");
  }
  if (input.isVerifiedRevenue) {
    pts += 20;
    reasons.push("Verified revenue path");
  }
  if (input.binanceCompatible) {
    pts += 10;
    reasons.push("Binance-compatible payments");
  }
  if (serviceSignals.endpointCount >= 2) {
    pts += 10;
    reasons.push("Multiple listed services");
  }
  const score = clampScore(pts);
  if (score === 0 && !reasons.length) {
    reasons.push("No monetization endpoints detected");
  }
  return { score, reasons: reasons.slice(0, 5) };
}
export function computeActivityScore(input: AgentScoringInput): LayerScoreResult {
  const reasons: string[] = [];
  const lastActive =
    input.lastActiveAt instanceof Date ? input.lastActiveAt : new Date(input.lastActiveAt);
  const fresh =
    input.scoreFreshness != null && (input.scoreDimensionsAuthoritative === true || input.scoreFreshness > 0)
      ? input.scoreFreshness
      : freshnessPts(lastActive);
  const hotNorm = Math.min(100, (input.hotScore ?? 0) * 10);
  const services = input.services ?? [];
  const serviceSignals = input.serviceSignals ?? deriveAgentServiceSignals(services);
  let svcPts = 0;
  if (serviceSignals.hasEndpoint) svcPts += 25;
  if (input.x402Support) svcPts += 20;
  if (serviceSignals.mcp) svcPts += 15;
  const syncedH = hoursSince(input.sapLastSyncedAt ?? null);
  let indexPts = 0;
  if (syncedH != null && syncedH <= 168) indexPts = 25;
  else if (syncedH != null && syncedH <= 720) indexPts = 12;
  if (fresh >= 60) reasons.push("Recently active");
  if (indexPts >= 20) reasons.push("Recently indexed");
  if (svcPts >= 25) reasons.push("Live service endpoints");
  if (input.x402Support) reasons.push("x402 endpoint active");
  const score = clampScore(fresh * 0.45 + hotNorm * 0.2 + svcPts * 0.2 + indexPts * 0.15);
  return { score, reasons: reasons.slice(0, 5) };
}
export function computeFinalRankScore(layers: {
  profile: number;
  protocolTrust: number;
  reputation: number;
  activity: number;
}): number {
  const w = FINAL_RANK_WEIGHTS;
  return clampScore(
    layers.profile * w.profile +
      layers.protocolTrust * w.protocolTrust +
      layers.reputation * w.reputation +
      layers.activity * w.activity,
  );
}
export function computeRankConfidence(
  layers: { profile: number; protocolTrust: number; reputation: number; activity: number },
  flags: {
    isPremiumVerified?: boolean;
    isVerified?: boolean;
    hasDuplicateName?: boolean;
    sapVerified?: boolean;
  },
): { band: RankConfidenceBand; summary: string } {
  const { profile, protocolTrust, reputation, activity } = layers;
  if (flags.isPremiumVerified && protocolTrust >= 55 && profile >= 45) {
    return { band: "Verified", summary: "" };
  }
  if (flags.hasDuplicateName) {
    return { band: "Low", summary: "" };
  }
  if (protocolTrust >= 60 && profile >= 50 && activity >= 40) {
    return { band: "High", summary: "" };
  }
  if (protocolTrust >= 35 || profile >= 40 || reputation >= 30) {
    return { band: "Medium", summary: "" };
  }
  return { band: "Low", summary: "" };
}
export function buildScoreBreakdown(layers: AgentScoreLayers) {
  return {
    profile: { score: layers.profile.score, reasons: layers.profile.reasons },
    protocolTrust: {
      score: layers.protocolTrust.score,
      reasons: layers.protocolTrust.reasons,
      ...(layers.protocolTrust.executionNote
        ? { executionNote: layers.protocolTrust.executionNote }
        : {}),
    },
    reputation: { score: layers.reputation.score, reasons: layers.reputation.reasons },
    activity: { score: layers.activity.score, reasons: layers.activity.reasons },
    monetization: { score: layers.monetization.score, reasons: layers.monetization.reasons },
  };
}
export function computeAgentScoreLayers(input: AgentScoringInput): AgentScoreLayers {
  const scoringInput = input.serviceSignals
    ? input
    : { ...input, serviceSignals: deriveAgentServiceSignals(input.services ?? []) };
  const profile = computeProfileScore(scoringInput);
  const protocolTrust = computeProtocolTrustScore(scoringInput);
  const reputation = computeReputationScore(scoringInput);
  const activity = computeActivityScore(scoringInput);
  const monetization = computeMonetizationScore(scoringInput);
  const agentRankScore = computeFinalRankScore({
    profile: profile.score,
    protocolTrust: protocolTrust.score,
    reputation: reputation.score,
    activity: activity.score,
  });
  const { band, summary } = computeRankConfidence(
    {
      profile: profile.score,
      protocolTrust: protocolTrust.score,
      reputation: reputation.score,
      activity: activity.score,
    },
    {
      isPremiumVerified: scoringInput.isPremiumVerified,
      isVerified: scoringInput.isVerified,
      hasDuplicateName: scoringInput.hasDuplicateName,
      sapVerified: scoringInput.sapVerified,
    },
  );
  return {
    profile,
    protocolTrust,
    reputation,
    activity,
    monetization,
    agentRankScore,
    rankConfidence: band,
    confidenceSummary: summary,
  };
}
/** Map DB row + relations into scoring input. */
export function agentScoringInputFromRow(row: {
  name: string;
  description?: string;
  image?: string;
  metadata?: Array<{ key: string; value: string }>;
  services?: Array<{ name: string; endpoint: string }>;
  scoreWallet?: number;
  x402Support?: boolean;
  binanceCompatible?: boolean;
  totalFeedback?: number;
  stars?: number;
  scoreQuality?: number | null;
  scoreMetadata?: number | null;
  scoreServices?: number | null;
  scoreSocial?: number | null;
  scoreFreshness?: number | null;
  scorePopularity?: number | null;
  hotScore?: number | null;
  socialSignals?: ReturnType<typeof computeSocialScore>;
  scoreDimensionsAuthoritative?: boolean;
  serviceSignals?: AgentServiceSignals;
  lastActiveAt?: Date | string;
  sapLastSyncedAt?: Date | string | null;
  isVerified?: boolean;
  isPremiumVerified?: boolean;
  sapVerified?: boolean;
  sapProtocols?: string[];
  sapStats?: unknown;
  sapReputationScore?: number | null;
  hasDuplicateName?: boolean;
  voteFireCount?: number;
  votePooCount?: number;
  isVerifiedRevenue?: boolean;
  verifiedWallet?: string | null;
  perfWinRate?: number | null;
  perfMonthlyPnlUsd?: number | null;
  perfBurnToEarnRatio?: number | null;
  perfTxCount?: number | null;
  activeWinRate30d?: number | null;
  nativeVolume30d?: number | null;
}): AgentScoringInput {
  const services = row.services ?? [];
  return {
    name: row.name,
    description: row.description ?? "",
    image: row.image ?? "",
    metadata: row.metadata ?? [],
    services,
    scoreWallet: row.scoreWallet ?? 0,
    x402Support: row.x402Support ?? false,
    binanceCompatible: row.binanceCompatible ?? false,
    totalFeedback: row.totalFeedback ?? 0,
    stars: row.stars ?? 0,
    scoreQuality: row.scoreQuality ?? 0,
    scoreMetadata: row.scoreMetadata ?? undefined,
    scoreServices: row.scoreServices ?? undefined,
    scoreSocial: row.scoreSocial ?? undefined,
    scoreFreshness: row.scoreFreshness ?? undefined,
    scorePopularity: row.scorePopularity ?? undefined,
    hotScore: row.hotScore ?? undefined,
    socialSignals: row.socialSignals,
    scoreDimensionsAuthoritative: row.scoreDimensionsAuthoritative,
    serviceSignals: row.serviceSignals ?? deriveAgentServiceSignals(services),
    lastActiveAt: row.lastActiveAt ?? new Date(),
    sapLastSyncedAt: row.sapLastSyncedAt,
    isVerified: row.isVerified,
    isPremiumVerified: row.isPremiumVerified,
    sapVerified: row.sapVerified,
    sapProtocols: row.sapProtocols,
    sapStats: row.sapStats,
    sapReputationScore: row.sapReputationScore,
    hasDuplicateName: row.hasDuplicateName,
    voteFireCount: row.voteFireCount,
    votePooCount: row.votePooCount,
    isVerifiedRevenue: row.isVerifiedRevenue,
    verifiedWallet: row.verifiedWallet,
    perfWinRate: row.perfWinRate,
    perfMonthlyPnlUsd: row.perfMonthlyPnlUsd,
    perfBurnToEarnRatio: row.perfBurnToEarnRatio,
    perfTxCount: row.perfTxCount,
    activeWinRate30d: row.activeWinRate30d,
    nativeVolume30d: row.nativeVolume30d,
  };
}
