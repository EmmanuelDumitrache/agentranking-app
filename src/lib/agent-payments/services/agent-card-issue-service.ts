import { randomUUID } from "node:crypto";
import { isCardIssuanceDevBypassActive } from "../config";
import {
  getCardIssuerProvider,
  getKripicardCardIssuer,
  isKripicardIssuerActive,
} from "../providers";
import type { CardIssuerRiskTier, IssuedCard } from "../providers/types";
import { getAgentRiskByAgentId } from "@/lib/verification/oracle-agent-risk";
import { maxDailyLimitUsdForTier } from "@/lib/verification/card-tier-limits";

function accountRiskFallback(): {
  eligible: boolean;
  riskTier: CardIssuerRiskTier;
  riskScore: number;
  maxDailyLimitUsd: number;
  reasons: string[];
} {
  const tier: CardIssuerRiskTier = "STANDARD";
  return {
    eligible: true,
    riskTier: tier,
    riskScore: 50,
    maxDailyLimitUsd: maxDailyLimitUsdForTier(tier),
    reasons: ["Account-level AR card"],
  };
}

export async function issueAgentPaymentCard(params: {
  appAccountId: string;
  agentId?: number | null;
  agentName?: string;
  displayName?: string;
  amountUsd: number;
  bin?: string;
  email?: string;
  dateOfBirth?: string;
  idempotencyKey: string;
}): Promise<IssuedCard> {
  if (isKripicardIssuerActive()) {
    const kripicard = getKripicardCardIssuer();
    let risk = accountRiskFallback();

    if (params.agentId != null) {
      const agentRisk = await getAgentRiskByAgentId(params.agentId);
      if (agentRisk.eligible) {
        risk = {
          eligible: true,
          riskTier: (agentRisk.riskTier ?? "STANDARD") as CardIssuerRiskTier,
          riskScore: agentRisk.riskScore ?? 50,
          maxDailyLimitUsd: agentRisk.maxDailyLimitUsd ?? maxDailyLimitUsdForTier("STANDARD"),
          reasons: agentRisk.reasons,
        };
      } else if (!isCardIssuanceDevBypassActive()) {
        throw new Error(agentRisk.reasons.join(" ") || "Agent not eligible for an AR card");
      }
    }

    const amountUsd = params.amountUsd;
    if (amountUsd < 10) {
      throw new Error("Minimum initial card balance is $10.");
    }

    return kripicard.createVirtualCard({
      agentId: params.agentId ?? null,
      appAccountId: params.appAccountId,
      agentName: params.agentName,
      riskTier: risk.riskTier,
      amountUsd,
      bin: params.bin,
      nameOnCard: params.displayName ?? (params.agentName ? `AR ${params.agentName}` : "AR AGENT"),
      email: params.email,
      dateOfBirth: params.dateOfBirth,
      idempotencyKey: params.idempotencyKey,
    });
  }

  return getCardIssuerProvider().issueCard({
    appAccountId: params.appAccountId,
    displayName: params.displayName ?? params.agentName ?? "AR AGENT",
    idempotencyKey: params.idempotencyKey,
  });
}

export function newCardIdempotencyKey(): string {
  return randomUUID();
}
