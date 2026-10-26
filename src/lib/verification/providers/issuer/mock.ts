import type {
  CardIssuer,
  CardIssuerEligibilityParams,
  CardIssuerEligibilityResult,
} from "../types";
import { maxDailyLimitUsdForTier } from "@/lib/verification/card-tier-limits";

/**
 * Demo card issuer. Maps risk tiers → daily USD limits from env.
 * No partner brand names in domain logic.
 */
export class MockCardIssuer implements CardIssuer {
  readonly name = "mock";
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
      reasons.push("Risk tier UNRATED does not qualify");
    }
    if (params.riskScore < 20) {
      reasons.push("Risk score below minimum threshold (20)");
    }
    if (eligible) {
      reasons.push(`Tier ${params.riskTier} maps to $${maxDailyLimitUsd}/day`);
    }

    return { eligible, maxDailyLimitUsd: eligible ? maxDailyLimitUsd : 0, reasons };
  }

  async requestCard(_params: unknown): Promise<unknown> {
    throw new Error("MockCardIssuer.requestCard is Phase 2 — not implemented.");
  }
}
