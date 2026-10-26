import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  ownerWalletAllowed,
  resolveKnownOwnerWallet,
  runPassportAssessment,
} from "@/lib/verification/assess";
import {
  computePassportHash,
  normalizeVerificationChain,
  verifyWalletSignature,
  walletsMatch,
} from "@/lib/verification/crypto";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const agentId = Number(record.agentId);
  const walletAddress = String(record.walletAddress ?? "").trim();
  const chainRaw = String(record.chain ?? "").trim();
  const signature = String(record.signature ?? "").trim();
  const nonce = String(record.nonce ?? "").trim();
  const chain = normalizeVerificationChain(chainRaw);

  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "agentId must be a positive integer" }, { status: 400 });
  }
  if (!walletAddress || !signature || !nonce || !chain) {
    return NextResponse.json(
      { error: "walletAddress, chain, signature, and nonce are required" },
      { status: 400 },
    );
  }

  const challenge = await prisma.ownershipChallenge.findUnique({ where: { nonce } });
  if (!challenge) {
    return NextResponse.json({ error: "Unknown or consumed nonce" }, { status: 400 });
  }
  if (challenge.consumedAt) {
    return NextResponse.json({ error: "Nonce already consumed (replay rejected)" }, { status: 409 });
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
  }
  if (challenge.agentId !== agentId) {
    return NextResponse.json({ error: "Nonce agent mismatch" }, { status: 400 });
  }
  if (!walletsMatch(challenge.walletAddress, walletAddress, chain)) {
    return NextResponse.json({ error: "Nonce wallet mismatch" }, { status: 400 });
  }
  if (challenge.chain !== chain) {
    return NextResponse.json({ error: "Nonce chain mismatch" }, { status: 400 });
  }

  const valid = await verifyWalletSignature({
    chain,
    walletAddress,
    message: challenge.message,
    signature,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const knownOwners = resolveKnownOwnerWallet(agent);
  if (!ownerWalletAllowed(walletAddress, chain, knownOwners)) {
    return NextResponse.json(
      { error: "Wallet does not match known agent owner wallet" },
      { status: 403 },
    );
  }

  const now = new Date();
  const passportHash = computePassportHash({
    agentId,
    ownerWallet: walletAddress,
    ownerWalletChain: chain,
    riskTier: "UNRATED",
    riskScore: 0,
    issuedAt: null,
  });

  const passport = await prisma.$transaction(async (tx) => {
    const updated = await tx.ownershipChallenge.updateMany({
      where: { nonce, consumedAt: null },
      data: { consumedAt: now },
    });
    if (updated.count !== 1) {
      throw new Error("NONCE_RACE");
    }

    const created = await tx.agentPassport.create({
      data: {
        ownerWallet: walletAddress,
        ownerWalletChain: chain,
        agentId,
        status: "PENDING",
        riskTier: "UNRATED",
        riskScore: 0,
        passportHash: `${passportHash}:${nonce.slice(0, 16)}`,
      },
    });

    await tx.ownershipProof.create({
      data: {
        passportId: created.id,
        walletAddress,
        chain,
        message: challenge.message,
        signature,
        nonce,
        verifiedAt: now,
        expiresAt: challenge.expiresAt,
      },
    });

    await tx.verificationEvent.create({
      data: {
        passportId: created.id,
        eventType: "created",
        detail: { agentId, walletAddress, chain },
      },
    });

    return created;
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === "NONCE_RACE") {
      return null;
    }
    throw err;
  });

  if (!passport) {
    return NextResponse.json({ error: "Nonce already consumed (replay rejected)" }, { status: 409 });
  }

  const assessment = await runPassportAssessment({
    passportId: passport.id,
    ownershipProven: true,
    walletAddresses: [walletAddress],
  });

  const refreshed = await prisma.agentPassport.findUnique({ where: { id: passport.id } });

  return NextResponse.json({
    passport: refreshed,
    assessment: {
      score: assessment.score,
      tier: assessment.tier,
      status: assessment.status,
      factors: assessment.factors,
      assessorVersion: assessment.assessorVersion,
      hardFail: assessment.hardFail,
    },
  });
}
