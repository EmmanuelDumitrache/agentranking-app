/**
 * Ephemeral builder reputation for social profiles — not persisted, not proof of honesty.
 */
export type BuilderReputationBand = "Low" | "Medium" | "High" | "Elite";
export type BuilderReputationResult =
  | { status: "insufficient"; label: "Insufficient data"; score: null }
  | { status: "ok"; label: BuilderReputationBand; score: number };
export type BuilderReputationInput = {
  linkedAgentCount: number;
  avgArScore: number;
  verifiedAgentCount: number;
  activeCompleteCount: number;
  totalReviews: number;
  protocolDiversity: number;
  signalCount: number;
};
const HIGH_SCORE_THRESHOLD = 62;
const ELITE_SCORE_THRESHOLD = 78;
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function reviewNorm(totalReviews: number): number {
  if (totalReviews <= 0) return 0;
  return clamp(Math.log10(totalReviews + 1) * 22, 0, 100);
}
function verifiedNorm(count: number, linked: number): number {
  if (linked <= 0) return 0;
  return clamp((count / linked) * 100, 0, 100);
}
function completeNorm(count: number, linked: number): number {
  if (linked <= 0) return 0;
  return clamp((count / linked) * 100, 0, 100);
}
function diversityNorm(score: number): number {
  return clamp(score, 0, 100);
}
function bandFromScore(score: number): BuilderReputationBand {
  if (score >= ELITE_SCORE_THRESHOLD) return "Elite";
  if (score >= HIGH_SCORE_THRESHOLD) return "High";
  if (score >= 38) return "Medium";
  return "Low";
}
export function countReputationSignals(input: BuilderReputationInput): number {
  let n = 0;
  if (input.linkedAgentCount > 0) n += 1;
  if (input.avgArScore > 0) n += 1;
  if (input.verifiedAgentCount > 0) n += 1;
  if (input.totalReviews > 0) n += 1;
  if (input.protocolDiversity > 0) n += 1;
  return n;
}
export function computeBuilderReputation(
  input: BuilderReputationInput,
): BuilderReputationResult {
  if (input.linkedAgentCount === 0 || input.signalCount < 2) {
    return { status: "insufficient", label: "Insufficient data", score: null };
  }
  const score = Math.round(
    clamp(input.avgArScore, 0, 100) * 0.4 +
      verifiedNorm(input.verifiedAgentCount, input.linkedAgentCount) * 0.2 +
      completeNorm(input.activeCompleteCount, input.linkedAgentCount) * 0.15 +
      reviewNorm(input.totalReviews) * 0.15 +
      diversityNorm(input.protocolDiversity) * 0.1,
  );
  return { status: "ok", label: bandFromScore(score), score };
}
export function protocolDiversityScore(flags: {
  hasSap: boolean;
  hasX402: boolean;
  hasMcp: boolean;
  hasErc8004: boolean;
}): number {
  let pts = 0;
  if (flags.hasSap) pts += 35;
  if (flags.hasX402) pts += 30;
  if (flags.hasMcp) pts += 25;
  if (flags.hasErc8004) pts += 10;
  return clamp(pts, 0, 100);
}
export function reputationMeetsHighThreshold(result: BuilderReputationResult): boolean {
  if (result.status !== "ok") return false;
  return result.score >= HIGH_SCORE_THRESHOLD;
}