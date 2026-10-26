import { prisma } from "@/lib/db";
import { collectAgentSignals } from "@/lib/verification/assess";
import { maxDailyLimitUsdForTier } from "@/lib/verification/card-tier-limits";
import { publicFactorSummary, type RiskFactorBreakdown } from "@/lib/verification/risk-engine";
import type { RiskTier } from "@/lib/verification/providers/types";

export interface AgentRiskRecommendation {
  found: boolean;
  wallet: string | null;
  agentId: number | null;
  agentName: string | null;
  riskTier: RiskTier | null;
  riskScore: number | null;
  eligible: boolean;
  maxDailyLimitUsd: number;
  issuer: string;
  reasons: string[];
}

function evaluateEligibility(riskTier: RiskTier, riskScore: number) {
  const maxDailyLimitUsd = maxDailyLimitUsdForTier(riskTier);
  const reasons: string[] = [];

  if (riskTier === "UNRATED") {
    reasons.push("Risk tier UNRATED does not qualify for card spend");
  }
  if (riskScore < 20) {
    reasons.push("Risk score below minimum threshold (20)");
  }

  const eligible = riskTier !== "UNRATED" && riskScore >= 20 && maxDailyLimitUsd > 0;
  if (eligible) {
    reasons.push(`Tier ${riskTier} maps to $${maxDailyLimitUsd}/day spend cap`);
  }

  return {
    eligible,
    maxDailyLimitUsd: eligible ? maxDailyLimitUsd : 0,
    reasons,
  };
}

export async function getAgentRiskByWallet(wallet: string): Promise<AgentRiskRecommendation> {
  const trimmed = wallet.trim();
  const issuerName =
    (process.env.CARD_ISSUER ?? process.env.CARD_ISSUER_PROVIDER ?? "mock").trim() ||
    "mock";

  const passport = await prisma.agentPassport.findFirst({
    where: {
      OR: [
        { ownerWallet: trimmed },
        { ownerWallet: { equals: trimmed, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      assessments: { orderBy: { assessedAt: "desc" }, take: 1 },
      agent: { select: { id: true, name: true } },
    },
  });

  if (!passport) {
    return {
      found: false,
      wallet: trimmed,
      agentId: null,
      agentName: null,
      riskTier: null,
      riskScore: null,
      eligible: false,
      maxDailyLimitUsd: 0,
      issuer: issuerName,
      reasons: ["No passport found for wallet"],
    };
  }

  return buildRecommendationFromPassport(passport, issuerName);
}

export async function getAgentRiskByAgentId(agentId: number): Promise<AgentRiskRecommendation> {
  const issuerName =
    (process.env.CARD_ISSUER ?? process.env.CARD_ISSUER_PROVIDER ?? "mock").trim() ||
    "mock";

  const passport = await prisma.agentPassport.findFirst({
    where: { agentId },
    orderBy: { updatedAt: "desc" },
    include: {
      assessments: { orderBy: { assessedAt: "desc" }, take: 1 },
      agent: { select: { id: true, name: true } },
    },
  });

  if (!passport) {
    return {
      found: false,
      wallet: null,
      agentId,
      agentName: null,
      riskTier: null,
      riskScore: null,
      eligible: false,
      maxDailyLimitUsd: 0,
      issuer: issuerName,
      reasons: ["No passport found for agent"],
    };
  }

  return buildRecommendationFromPassport(passport, issuerName);
}

async function buildRecommendationFromPassport(
  passport: {
    ownerWallet: string;
    riskTier: RiskTier;
    riskScore: number;
    agent: { id: number; name: string };
    assessments: Array<{ factors: unknown }>;
  },
  issuerName: string,
): Promise<AgentRiskRecommendation> {
  await collectAgentSignals(passport.agent.id);
  const factorsRaw = passport.assessments[0]?.factors as RiskFactorBreakdown | undefined;
  if (factorsRaw) publicFactorSummary(factorsRaw);

  const eligibility = evaluateEligibility(passport.riskTier, passport.riskScore);

  return {
    found: true,
    wallet: passport.ownerWallet,
    agentId: passport.agent.id,
    agentName: passport.agent.name,
    riskTier: passport.riskTier,
    riskScore: passport.riskScore,
    eligible: eligibility.eligible,
    maxDailyLimitUsd: eligibility.maxDailyLimitUsd,
    issuer: issuerName,
    reasons: eligibility.reasons,
  };
}
