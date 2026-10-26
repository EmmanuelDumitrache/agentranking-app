import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publicFactorSummary, type RiskFactorBreakdown } from "@/lib/verification/risk-engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const passport = await prisma.agentPassport.findUnique({
    where: { id },
    include: {
      agent: { select: { id: true, name: true, chainId: true, image: true, score: true } },
      assessments: { orderBy: { assessedAt: "desc" }, take: 1 },
      events: { orderBy: { createdAt: "desc" }, take: 25 },
      delegations: {
        where: { active: true },
        include: {
          delegatedAgent: { select: { id: true, name: true, chainId: true } },
        },
      },
    },
  });

  if (!passport) {
    return NextResponse.json({ error: "Passport not found" }, { status: 404 });
  }

  const factorsRaw = passport.assessments[0]?.factors as unknown as
    | RiskFactorBreakdown
    | undefined;

  return NextResponse.json({
    passport: {
      id: passport.id,
      status: passport.status,
      riskTier: passport.riskTier,
      riskScore: passport.riskScore,
      ownerWallet: passport.ownerWallet,
      ownerWalletChain: passport.ownerWalletChain,
      issuedAt: passport.issuedAt?.toISOString() ?? null,
      expiresAt: passport.expiresAt?.toISOString() ?? null,
      lastScreenedAt: passport.lastScreenedAt?.toISOString() ?? null,
      passportHash: passport.passportHash,
      anchorTx: passport.anchorTx,
    },
    agent: passport.agent,
    factors: factorsRaw ? publicFactorSummary(factorsRaw) : null,
    factorsDetail: factorsRaw ?? null,
    delegations: passport.delegations.map((d) => ({
      id: d.id,
      delegatedWallet: d.delegatedWallet,
      scopes: d.scopes,
      agent: d.delegatedAgent,
      createdAt: d.createdAt.toISOString(),
    })),
    events: passport.events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
