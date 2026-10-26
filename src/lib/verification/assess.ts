import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import {
  computePassportHash,
  passportValidityDays,
  type VerificationChain,
} from "./crypto";
import { computeRiskScore, type RiskEngineInput } from "./risk-engine";
import type { PassportStatus, RiskTier } from "./providers/types";

export interface AgentSignals {
  onchainAgeDays: number;
  txCount: number;
  volumeUsd: number;
  uniqueCounterparties: number;
  endpointAlive: boolean;
  capabilityConsistent: boolean;
  platformReputationScore: number;
  chains: string[];
  name: string;
  endpointUrl: string | null;
}

/**
 * Gather risk-engine inputs from indexed agent data.
 * Phase 1 uses best-effort heuristics from Agent fields; no external RPC required for demo.
 */
export async function collectAgentSignals(agentDbId: number): Promise<AgentSignals | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    include: { chain: true },
  });
  if (!agent) return null;

  const created =
    agent.sapRegisteredAt ??
    agent.solanaBlockTime ??
    agent.listedAt ??
    agent.createdAt;
  const onchainAgeDays = Math.max(
    0,
    Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000)),
  );

  const endpointUrl =
    agent.sapX402Endpoint?.trim() ||
    agent.agentURI?.trim() ||
    null;

  let endpointAlive = false;
  if (endpointUrl && /^https?:\/\//i.test(endpointUrl)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_500);
      const res = await fetch(endpointUrl, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      endpointAlive = res.status > 0 && res.status < 500;
    } catch {
      endpointAlive = false;
    }
  }

  const txCount = Math.max(agent.totalFeedback, agent.totalMessages, 0);
  const volumeUsd = Math.max(0, agent.scoreVerifiedRevenue * 100);
  const uniqueCounterparties = Math.min(100, Math.max(0, agent.totalFeedback + agent.totalChats));
  const capabilityConsistent =
    Boolean(agent.sapCapabilities) ||
    agent.x402Support ||
    (Array.isArray(agent.sapProtocols) && agent.sapProtocols.length > 0);

  return {
    onchainAgeDays,
    txCount,
    volumeUsd,
    uniqueCounterparties,
    endpointAlive,
    capabilityConsistent,
    platformReputationScore: Math.max(0, Math.min(100, agent.score)),
    chains: agent.chain?.shortName ? [agent.chain.shortName] : [String(agent.chainId)],
    name: agent.name,
    endpointUrl,
  };
}

export async function runPassportAssessment(params: {
  passportId: string;
  ownershipProven: boolean;
  walletAddresses: string[];
}): Promise<{
  score: number;
  tier: RiskTier;
  status: PassportStatus;
  factors: unknown;
  assessorVersion: string;
  hardFail: boolean;
}> {
  const passport = await prisma.agentPassport.findUnique({
    where: { id: params.passportId },
  });
  if (!passport) throw new Error("Passport not found");

  const signals = await collectAgentSignals(passport.agentId);
  if (!signals) throw new Error("Agent not found for passport");

  const input: RiskEngineInput = {
    ownershipProven: params.ownershipProven,
    onchainAgeDays: signals.onchainAgeDays,
    txCount: signals.txCount,
    volumeUsd: signals.volumeUsd,
    uniqueCounterparties: signals.uniqueCounterparties,
    endpointAlive: signals.endpointAlive,
    capabilityConsistent: signals.capabilityConsistent,
    walletAddresses: params.walletAddresses,
    platformReputationScore: signals.platformReputationScore,
  };

  const result = await computeRiskScore(input);
  const previousTier = passport.riskTier as RiskTier;
  const now = new Date();
  const validityDays = passportValidityDays();
  const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const status: PassportStatus = result.hardFail
    ? "SUSPENDED"
    : result.score >= 20
      ? "ACTIVE"
      : "PENDING";

  const passportHash = computePassportHash({
    agentId: passport.agentId,
    ownerWallet: passport.ownerWallet,
    ownerWalletChain: passport.ownerWalletChain,
    riskTier: result.tier,
    riskScore: result.score,
    issuedAt: (passport.issuedAt ?? now).toISOString(),
  });

  await prisma.$transaction(async (tx) => {
    await tx.riskAssessment.create({
      data: {
        passportId: passport.id,
        score: result.score,
        tier: result.tier,
        factors: result.factors as unknown as Prisma.InputJsonValue,
        assessorVersion: result.assessorVersion,
      },
    });

    await tx.agentPassport.update({
      where: { id: passport.id },
      data: {
        riskScore: result.score,
        riskTier: result.tier,
        status,
        lastScreenedAt: now,
        passportHash,
        issuedAt: passport.issuedAt ?? (status === "ACTIVE" ? now : passport.issuedAt),
        expiresAt: status === "ACTIVE" || status === "SUSPENDED" ? expiresAt : passport.expiresAt,
        ...(result.hardFail
          ? {
              revocationReason: "sanctions_screening_hard_fail",
            }
          : {}),
      },
    });

    await tx.verificationEvent.create({
      data: {
        passportId: passport.id,
        eventType: result.hardFail ? "suspended" : "screened",
        detail: {
          score: result.score,
          tier: result.tier,
          previousTier,
          hardFail: result.hardFail,
          assessorVersion: result.assessorVersion,
        },
      },
    });

    if (previousTier !== result.tier) {
      await tx.verificationEvent.create({
        data: {
          passportId: passport.id,
          eventType: "tier_changed",
          detail: { from: previousTier, to: result.tier, score: result.score },
        },
      });
    }
  });

  return {
    score: result.score,
    tier: result.tier,
    status,
    factors: result.factors,
    assessorVersion: result.assessorVersion,
    hardFail: result.hardFail,
  };
}

export function resolveKnownOwnerWallet(agent: {
  owner: string;
  sapOwnerWallet: string | null;
  verifiedWallet: string | null;
  registeredOwner: string;
}): string[] {
  return [agent.sapOwnerWallet, agent.verifiedWallet, agent.owner, agent.registeredOwner]
    .map((w) => w?.trim() ?? "")
    .filter(Boolean);
}

export function ownerWalletAllowed(
  walletAddress: string,
  chain: VerificationChain,
  knownOwners: string[],
): boolean {
  if (knownOwners.length === 0) return true;
  const normalize = (w: string) =>
    chain === "evm" ? w.trim().toLowerCase() : w.trim();
  const target = normalize(walletAddress);
  return knownOwners.some((o) => normalize(o) === target);
}
