import type {
  CardIssuer,
  CardIssuerEligibilityParams,
  CardIssuerEligibilityResult,
} from "../types";
import { maxDailyLimitUsdForTier } from "@/lib/verification/card-tier-limits";

/** AR virtual cards — eligibility oracle for AgentRanking branded cards. */
export class ArVerificationCardIssuer implements CardIssuer {
  readonly name = "ar";
  readonly supportsAgentCards = true;

  async checkEligibility(
    params: CardIssuerEligibilityParams,
  ): Promise<CardIssuerEligibilityResult> {
    const maxDailyLimitUsd = maxDailyLimitUsdForTier(params.riskTier);
    const eligible =
      params.riskTier !== "UNRATED" &&
      params.riskScore >= 20 &&
      maxDailyLimitUsd > 0;

    const reasons: string[] = [];
    if (params.riskTier === "UNRATED") {
      reasons.push("Complete agent verification before issuing an AR card");
    }
    if (params.riskScore < 20) {
      reasons.push("Risk score below minimum threshold");
    }
    if (eligible) {
      reasons.push(`Tier ${params.riskTier} — up to $${maxDailyLimitUsd}/day spend`);
    }

    return { eligible, maxDailyLimitUsd: eligible ? maxDailyLimitUsd : 0, reasons };
  }

  async requestCard(_params: unknown): Promise<unknown> {
    throw new Error("AR card issuance is handled via the treasury dashboard.");
  }
}
