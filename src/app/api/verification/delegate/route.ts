import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildDelegationMessage,
  challengeTtlMs,
  generateNonce,
  normalizeVerificationChain,
  verifyWalletSignature,
} from "@/lib/verification/crypto";

export const runtime = "nodejs";

/**
 * Two-step friendly: if `signature` omitted, creates a challenge and returns message to sign.
 * If `signature` + `nonce` provided, verifies and creates AgentDelegation.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const parentPassportId = String(record.parentPassportId ?? "").trim();
  const delegatedAgentId = Number(record.delegatedAgentId);
  const delegatedWallet = String(record.delegatedWallet ?? "").trim();
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.map((s) => String(s))
    : ["card.issue", "card.spend"];
  const signature = String(record.signature ?? "").trim();
  const nonce = String(record.nonce ?? "").trim();

  if (!parentPassportId) {
    return NextResponse.json({ error: "parentPassportId is required" }, { status: 400 });
  }
  if (!Number.isInteger(delegatedAgentId) || delegatedAgentId <= 0) {
    return NextResponse.json({ error: "delegatedAgentId must be a positive integer" }, { status: 400 });
  }
  if (!delegatedWallet) {
    return NextResponse.json({ error: "delegatedWallet is required" }, { status: 400 });
  }

  const parent = await prisma.agentPassport.findUnique({ where: { id: parentPassportId } });
  if (!parent) {
    return NextResponse.json({ error: "Parent passport not found" }, { status: 404 });
  }
  if (parent.status !== "ACTIVE") {
    return NextResponse.json({ error: "Parent passport must be ACTIVE" }, { status: 403 });
  }

  const delegatedAgent = await prisma.agent.findUnique({
    where: { id: delegatedAgentId },
    select: { id: true },
  });
  if (!delegatedAgent) {
    return NextResponse.json({ error: "Delegated agent not found" }, { status: 404 });
  }

  const chain = normalizeVerificationChain(parent.ownerWalletChain) ?? "solana";

  if (!signature) {
    const expiresAt = new Date(Date.now() + challengeTtlMs());
    const challengeNonce = generateNonce();
    const message = buildDelegationMessage({
      ownerWallet: parent.ownerWallet,
      delegatedWallet,
      delegatedAgentId,
      scopes,
      nonce: challengeNonce,
    });
    await prisma.ownershipChallenge.create({
      data: {
        agentId: delegatedAgentId,
        walletAddress: parent.ownerWallet,
        chain,
        purpose: "delegation",
        nonce: challengeNonce,
        message,
        expiresAt,
      },
    });
    return NextResponse.json({
      mode: "challenge",
      nonce: challengeNonce,
      message,
      expiresAt: expiresAt.toISOString(),
      scopes,
    });
  }

  if (!nonce) {
    return NextResponse.json({ error: "nonce is required with signature" }, { status: 400 });
  }

  const challenge = await prisma.ownershipChallenge.findUnique({ where: { nonce } });
  if (!challenge || challenge.purpose !== "delegation") {
    return NextResponse.json({ error: "Unknown delegation nonce" }, { status: 400 });
  }
  if (challenge.consumedAt) {
    return NextResponse.json({ error: "Nonce already consumed (replay rejected)" }, { status: 409 });
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
  }

  const message = buildDelegationMessage({
    ownerWallet: parent.ownerWallet,
    delegatedWallet,
    delegatedAgentId,
    scopes,
    nonce,
  });
  if (challenge.message !== message) {
    return NextResponse.json({ error: "Delegation message mismatch" }, { status: 400 });
  }

  const valid = await verifyWalletSignature({
    chain,
    walletAddress: parent.ownerWallet,
    message,
    signature,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid parent wallet signature" }, { status: 401 });
  }

  const now = new Date();
  const delegation = await prisma.$transaction(async (tx) => {
    const consumed = await tx.ownershipChallenge.updateMany({
      where: { nonce, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new Error("NONCE_RACE");

    return tx.agentDelegation.create({
      data: {
        parentPassportId,
        delegatedAgentId,
        delegatedWallet,
        signature,
        scopes,
        active: true,
      },
    });
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === "NONCE_RACE") return null;
    throw err;
  });

  if (!delegation) {
    return NextResponse.json({ error: "Nonce already consumed (replay rejected)" }, { status: 409 });
  }

  await prisma.verificationEvent.create({
    data: {
      passportId: parentPassportId,
      eventType: "delegated",
      detail: {
        delegationId: delegation.id,
        delegatedAgentId,
        delegatedWallet,
        scopes,
      },
    },
  });

  return NextResponse.json({ delegation });
}
