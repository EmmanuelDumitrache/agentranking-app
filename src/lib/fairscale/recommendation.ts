import type { FairscaleRecommendation } from "@/lib/fairscale/types";

export function resolveFairscaleRecommendationLabel(input: {
  recommendation?: FairscaleRecommendation | null;
  score?: number | null;
}): string | null {
  const apiLabel = input.recommendation?.label?.trim();
  if (apiLabel) return apiLabel;

  const score = input.score;
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }

  if (score >= 61) return "Trusted";
  if (score >= 41) return "Caution";
  if (score >= 21) return "High risk";
  return "Unverified";
}

export function resolveFairscaleRecommendationTier(input: {
  recommendation?: FairscaleRecommendation | null;
  tier?: string | null;
}): string | null {
  const apiTier = input.recommendation?.tier?.trim() || input.tier?.trim();
  return apiTier || null;
}
