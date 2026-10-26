/**
 * Agent Risk Oracle — public product endpoint.
 *
 * CRITICAL CONSTRAINT:
 * This response must NEVER include personal data (PII) of any kind.
 * No names of natural persons, emails, government IDs, KYC documents,
 * residential addresses, phone numbers, or identity-provider payloads.
 * Only agent/wallet risk signals and opaque attestation hashes are allowed.
 * If a field could identify a human, it does not belong here.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { collectAgentSignals } from "@/lib/verification/assess";
import { getCardIssuer } from "@/lib/verification/providers";
import { publicFactorSummary, type RiskFactorBreakdown } from "@/lib/verification/risk-engine";
import type { RiskTier } from "@/lib/verification/providers/types";

export const runtime = "nodejs";

const CACHE_SECONDS = 60;

const PII_FIELD_DENYLIST = [
  "email",
  "phone",
  "ssn",
  "passportNumber",
  "dateOfBirth",
  "fullName",
  "firstName",
  "lastName",
  "address",
  "governmentId",
  "selfie",
  "kycPayload",
  "pii",
] as const;

function assertNoPiiKeys(value: unknown, path = "root"): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoPiiKeys(item, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (PII_FIELD_DENYLIST.some((denied) => lower.includes(denied.toLowerCase()))) {
      throw new Error(`PII field blocked in oracle response: ${path}.${key}`);
    }
    assertNoPiiKeys(child, `${path}.${key}`);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = (url.searchParams.get("wallet") ?? "").trim();
  if (!wallet) {
    return NextResponse.json({ error: "wallet query param is required" }, { status: 400 });
  }

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
      agent: { select: { id: true, name: true, chainId: true } },
    },
  });

  const issuer = getCardIssuer();

  if (!passport) {
    const payload = {
      wallet,
      found: false,
      passport: null,
      agent: null,
      factors: null,
      recommendation: {
        eligible: false,
        maxDailyLimitUsd: 0,
        issuer: issuer.name,
      },
      attestationHash: null,
      version: "1.0",
    };
    assertNoPiiKeys(payload);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=30` },
    });
  }

  const signals = await collectAgentSignals(passport.agentId);
  const factorsRaw = passport.assessments[0]?.factors as unknown as
    | RiskFactorBreakdown
    | undefined;
  const factors = factorsRaw ? publicFactorSummary(factorsRaw) : null;

  const eligibility = await issuer.checkEligibility({
    agentWallet: passport.ownerWallet,
    riskTier: passport.riskTier as RiskTier,
    riskScore: passport.riskScore,
  });

  const payload = {
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
    agent: {
      id: passport.agent.id,
      name: passport.agent.name,
      chains: signals?.chains ?? [],
      onchainAgeDays: signals?.onchainAgeDays ?? 0,
    },
    factors,
    recommendation: {
      eligible: eligibility.eligible,
      maxDailyLimitUsd: eligibility.maxDailyLimitUsd,
      issuer: issuer.name,
    },
    attestationHash: passport.passportHash,
    version: "1.0",
  };

  assertNoPiiKeys(payload);

  return NextResponse.json(payload, {
    headers: { "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=30` },
  });
}
