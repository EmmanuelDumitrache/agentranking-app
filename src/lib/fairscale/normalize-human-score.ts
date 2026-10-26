import type { FairscaleHumanScoreResponse, FairscaleScoreResponse } from "@/lib/fairscale/types";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Map human Reputation `GET /score` into the shape our Trust card / DB already use.
 * Docs: fairscore 0–100, tier, badges, features, score_composition, etc.
 */
export function normalizeHumanScoreResponse(
  data: FairscaleHumanScoreResponse,
): FairscaleScoreResponse {
  const fairscore =
    asNumber(data.fairscore) ?? asNumber(data.final_score) ?? asNumber(data.score);

  const verifiedHuman = data.verified_human === true;

  return {
    wallet: typeof data.wallet === "string" ? data.wallet : undefined,
    score: fairscore ?? undefined,
    tier: typeof data.tier === "string" ? data.tier : null,
    recommendation: null,
    pillars: null,
    signals: {
      source: "human:/score",
      fairscore_base: data.fairscore_base ?? null,
      social_score: data.social_score ?? null,
      peer_score: data.peer_score ?? null,
      real_world_presence: data.real_world_presence ?? null,
      verified_human: verifiedHuman,
      identity_pillar: data.identity_pillar ?? null,
      program_pillar: data.program_pillar ?? null,
      ownership_pillar: data.ownership_pillar ?? null,
      score_composition: data.score_composition ?? null,
      program_memberships: data.program_memberships ?? null,
      features: data.features ?? null,
      actions: data.actions ?? null,
    },
    red_flags: null,
    badges: data.badges ?? null,
    description_alignment: null,
    verifications: {
      verified_human: verifiedHuman,
    },
    meta: {
      scored_at: typeof data.timestamp === "string" ? data.timestamp : null,
      from_cache: data.cached === true,
      provider: "FairScale",
    },
    error: typeof data.error === "string" ? data.error : null,
  };
}
