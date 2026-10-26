import { VALIDATION_PASS_SCORE, isChainVerificationPass } from "@/lib/validation-registry-core";
import type { RankingTier, RankingTierResult, UnifiedAgentProfile, ValidationMethod } from "@/types/agent";
export const RANK_VALIDATION_WEIGHTS = {
  baseReputationMax: 40,
  anyPassBoost: 25,
  cryptoEconomicPass: 15,
  zkmlPassRecent: 35,
  teePassRecent: 45,
  multiChainBoost: 8,
  listedFloor: 12,
  verifiedFloor: 55,
  attestedFloor: 72,
  eliteFloor: 88,
} as const;
const RECENT_PASS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
function meanReputationScore(profile: UnifiedAgentProfile): number {
  if (profile.reputationByChain.length === 0) return 0;
  const sum = profile.reputationByChain.reduce((acc, row) => acc + row.reputationScore, 0);
  return sum / profile.reputationByChain.length;
}
function recentPassRecords(profile: UnifiedAgentProfile, now: number) {
  const out: Array<{ method: ValidationMethod; score: number }> = [];
  const seen = new Set<string>();
  for (const footprint of profile.validationByChain) {
    for (const record of footprint.records) {
      if (record.status !== "passed" || !isChainVerificationPass(record.score ?? 0)) continue;
      if (record.attestedAt && now - record.attestedAt.getTime() > RECENT_PASS_WINDOW_MS) continue;
      const key = `${record.chainId}:${record.agentId}:${record.requestHash}:${record.txHash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ method: record.method, score: record.score ?? 0 });
    }
  }
  return out;
}
function tierFromScore(score: number, hasDeployments: boolean, hasAnyPass: boolean): RankingTier {
  if (!hasDeployments) return "unranked";
  if (score >= RANK_VALIDATION_WEIGHTS.eliteFloor && hasAnyPass) return "elite";
  if (score >= RANK_VALIDATION_WEIGHTS.attestedFloor && hasAnyPass) return "attested";
  if (score >= RANK_VALIDATION_WEIGHTS.verifiedFloor) return "verified";
  if (score >= RANK_VALIDATION_WEIGHTS.listedFloor) return "listed";
  return "unranked";
}
/**
 * Platform ranking tier — validation-heavy and distinct from KYA trust score.
 */
export function computeRankingTier(profile: UnifiedAgentProfile, now = new Date()): RankingTierResult {
  const reasons: string[] = [];
  const nowMs = now.getTime();
  const hasDeployments = profile.deployments.length > 0;
  const indexedDeployments = profile.deployments.filter((d) => d.indexed);
  if (!hasDeployments) {
    return {
      tier: "unranked",
      score: 0,
      reasons: ["No ERC-8004 deployments discovered for wallet"],
      validationBoost: 0,
    };
  }
  let score = Math.min(
    RANK_VALIDATION_WEIGHTS.baseReputationMax,
    meanReputationScore(profile) * (RANK_VALIDATION_WEIGHTS.baseReputationMax / 100),
  );
  reasons.push(`Base reputation contribution: ${Math.round(score)}`);
  if (profile.deployments.length >= 2) {
    score += RANK_VALIDATION_WEIGHTS.multiChainBoost;
    reasons.push("Multi-chain footprint boost");
  }
  let validationBoost = 0;
  const passes = recentPassRecords(profile, nowMs);
  const hasAnyPass = passes.length > 0 || profile.validationByChain.some((f) => f.hasRecentPass);
  if (hasAnyPass) {
    validationBoost += RANK_VALIDATION_WEIGHTS.anyPassBoost;
    reasons.push(`Validation pass detected (threshold ${VALIDATION_PASS_SCORE})`);
  }
  for (const pass of passes) {
    if (pass.method === "tee") {
      validationBoost += RANK_VALIDATION_WEIGHTS.teePassRecent;
      reasons.push("Recent TEE validation pass");
    } else if (pass.method === "zkml") {
      validationBoost += RANK_VALIDATION_WEIGHTS.zkmlPassRecent;
      reasons.push("Recent zkML validation pass");
    } else if (pass.method === "crypto_economic") {
      validationBoost += RANK_VALIDATION_WEIGHTS.cryptoEconomicPass;
      reasons.push("Recent crypto-economic validation pass");
    }
  }
  score += validationBoost;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = tierFromScore(score, indexedDeployments.length > 0 || hasDeployments, hasAnyPass);
  return {
    tier,
    score,
    reasons,
    validationBoost,
  };
}