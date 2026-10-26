import type { TrustDimensionValues } from "@/lib/agent-score";
/**
 * Explain how verification signals influence AR Score dimensions (read-only hints).
 */
export function signalHintsForDimensions(
  signals: Array<{ signalType: string; status: string }>,
): Partial<Record<keyof TrustDimensionValues, string[]>> {
  const has = (type: string) =>
    signals.some(
      (s) => s.signalType === type && ["verified", "detected", "partner_registered"].includes(s.status),
    );
  const hints: Partial<Record<keyof TrustDimensionValues, string[]>> = {};
  if (has("agentranking_verified")) {
    hints.metadata = [...(hints.metadata ?? []), "AgentRanking verification boosts metadata legitimacy"];
  }
  if (has("official_links_locked")) {
    hints.social = [...(hints.social ?? []), "Official links locked"];
  }
  if (has("endpoint_live")) {
    hints.endpoints = [...(hints.endpoints ?? []), "Live endpoint checks passing"];
  }
  if (has("x402_detected") || has("x402_payable")) {
    hints.compliance = [...(hints.compliance ?? []), "x402 monetization signals detected"];
  }
  if (has("devproof_active")) {
    hints.freshness = [...(hints.freshness ?? []), "DevProof shows active development"];
  }
  if (has("payment_wallet_verified")) {
    hints.verifiedRevenue = [...(hints.verifiedRevenue ?? []), "Payment/execution wallet linked"];
  }
  return hints;
}
export type ScoreBreakdownHintKey =
  | "profile"
  | "protocolTrust"
  | "reputation"
  | "activity"
  | "monetization";
/** Map verification signals to public score-tab breakdown rows (B6). */
export function signalHintsForScoreBreakdown(
  signals: Array<{ signalType: string; status: string }>,
): Partial<Record<ScoreBreakdownHintKey, string[]>> {
  const has = (type: string, statuses = ["verified", "detected", "partner_registered"]) =>
    signals.some((s) => s.signalType === type && statuses.includes(s.status));
  const hints: Partial<Record<ScoreBreakdownHintKey, string[]>> = {};
  if (has("agentranking_verified")) {
    hints.profile = [...(hints.profile ?? []), "AgentRanking verification active"];
    hints.protocolTrust = [...(hints.protocolTrust ?? []), "Verified on AgentRanking"];
  }
  if (has("claimed_by_team")) {
    hints.protocolTrust = [...(hints.protocolTrust ?? []), "Claimed by owner wallet"];
  }
  if (has("official_links_locked")) {
    hints.profile = [...(hints.profile ?? []), "Official links locked by owner"];
  }
  if (has("endpoint_live")) {
    hints.activity = [...(hints.activity ?? []), "Live endpoint health checks"];
  }
  if (has("endpoint_failing", ["failed", "stale"])) {
    hints.activity = [...(hints.activity ?? []), "Endpoint health issues detected"];
  }
  if (has("x402_detected") || has("x402_payable")) {
    hints.monetization = [...(hints.monetization ?? []), "x402 monetization signals"];
  }
  if (has("mcp_detected") || has("mcp_verified")) {
    hints.monetization = [...(hints.monetization ?? []), "MCP service detected"];
  }
  if (has("devproof_active")) {
    hints.activity = [...(hints.activity ?? []), "GitHub DevProof shows active development"];
  }
  if (has("payment_wallet_verified")) {
    hints.protocolTrust = [...(hints.protocolTrust ?? []), "Execution wallet linked"];
  }
  if (has("sap_registered")) {
    hints.protocolTrust = [...(hints.protocolTrust ?? []), "SAP partner registration"];
  }
  return hints;
}