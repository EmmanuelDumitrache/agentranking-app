/**
 * Protocol-neutral tool handlers for the Verification Layer oracle.
 *
 * These are domain operations, not an MCP server/runtime. Any MCP exposure must
 * be adapted through the canonical agent-chat MCP subsystem. Responses contain NO PII.
 */

import { prisma } from "@/lib/db";
import { getCardIssuer } from "@/lib/verification/providers";
import type { RiskTier } from "@/lib/verification/providers/types";
import { publicFactorSummary, type RiskFactorBreakdown } from "@/lib/verification/risk-engine";

export const VERIFICATION_ORACLE_TOOLS = [
  {
    name: "get_agent_risk",
    tier: "free" as const,
    description:
      "Public Agent Risk Oracle by wallet. Returns risk tier, score, factor summary, and card eligibility recommendation. Never returns PII.",
    inputSchema: {
      type: "object",
      required: ["wallet"],
      properties: {
        wallet: { type: "string", description: "Agent owner wallet address" },
      },
    },
  },
  {
    name: "get_agent_passport",
    tier: "free" as const,
    description:
      "Fetch an Agent Passport by agent database id (Agent.id). No PII.",
    inputSchema: {
      type: "object",
      required: ["agent_id"],
      properties: {
        agent_id: { type: "number", description: "Agent database primary key" },
      },
    },
  },
  {
    name: "check_card_eligibility",
    tier: "free" as const,
    description:
      "Check card spend eligibility for a wallet via the configured issuer adapter.",
    inputSchema: {
      type: "object",
      required: ["wallet"],
      properties: {
        wallet: { type: "string", description: "Agent owner wallet address" },
      },
    },
  },
] as const;

export async function getAgentRiskOracle(wallet: string) {
  const passport = await prisma.agentPassport.findFirst({
    where: {
      OR: [
        { ownerWallet: wallet },
        { ownerWallet: { equals: wallet, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      assessments: { orderBy: { assessedAt: "desc" }, take: 1 },
      agent: { select: { id: true, name: true } },
    },
  });
  const issuer = getCardIssuer();
  if (!passport) {
    return {
      wallet,
      found: false,
      passport: null,
      recommendation: { eligible: false, maxDailyLimitUsd: 0, issuer: issuer.name },
    };
  }
  const factorsRaw = passport.assessments[0]?.factors as unknown as
    | RiskFactorBreakdown
    | undefined;
  const eligibility = await issuer.checkEligibility({
    agentWallet: passport.ownerWallet,
    riskTier: passport.riskTier as RiskTier,
    riskScore: passport.riskScore,
  });
  return {
    wallet: passport.ownerWallet,
    found: true,
    passport: {
      status: passport.status,
      riskTier: passport.riskTier,
      riskScore: passport.riskScore,
      issuedAt: passport.issuedAt?.toISOString() ?? null,
      expiresAt: passport.expiresAt?.toISOString() ?? null,
      lastScreenedAt: passport.lastScreenedAt?.toISOString() ?? null,
    },
    agent: passport.agent,
    factors: factorsRaw ? publicFactorSummary(factorsRaw) : null,
    recommendation: {
      eligible: eligibility.eligible,
      maxDailyLimitUsd: eligibility.maxDailyLimitUsd,
      issuer: issuer.name,
    },
    attestationHash: passport.passportHash,
    version: "1.0",
  };
}

export async function getAgentPassportOracle(agentId: number) {
  const passport = await prisma.agentPassport.findFirst({
    where: { agentId },
    orderBy: { updatedAt: "desc" },
    include: {
      assessments: { orderBy: { assessedAt: "desc" }, take: 1 },
      delegations: { where: { active: true }, take: 20 },
    },
  });
  if (!passport) return { found: false, passport: null };
  const factorsRaw = passport.assessments[0]?.factors as unknown as
    | RiskFactorBreakdown
    | undefined;
  return {
    found: true,
    passport: {
      id: passport.id,
      status: passport.status,
      riskTier: passport.riskTier,
      riskScore: passport.riskScore,
      ownerWallet: passport.ownerWallet,
      issuedAt: passport.issuedAt?.toISOString() ?? null,
      expiresAt: passport.expiresAt?.toISOString() ?? null,
      passportHash: passport.passportHash,
    },
    factors: factorsRaw ? publicFactorSummary(factorsRaw) : null,
    activeDelegations: passport.delegations.length,
  };
}

export async function checkCardEligibilityOracle(wallet: string) {
  const risk = await getAgentRiskOracle(wallet);
  if (!risk.found || !risk.passport) {
    return {
      wallet,
      eligible: false,
      maxDailyLimitUsd: 0,
      issuer: risk.recommendation.issuer,
      reasons: ["No active passport for wallet"],
    };
  }
  const issuer = getCardIssuer();
  const result = await issuer.checkEligibility({
    agentWallet: wallet,
    riskTier: risk.passport.riskTier as RiskTier,
    riskScore: risk.passport.riskScore,
  });
  return {
    wallet,
    ...result,
    issuer: issuer.name,
    riskTier: risk.passport.riskTier,
    riskScore: risk.passport.riskScore,
  };
}
