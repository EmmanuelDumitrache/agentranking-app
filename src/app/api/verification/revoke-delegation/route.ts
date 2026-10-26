import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildRevokeDelegationMessage,
  challengeTtlMs,
  generateNonce,
  normalizeVerificationChain,
  verifyWalletSignature,
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
  const delegationId = String(record.delegationId ?? "").trim();
  const parentPassportId = String(record.parentPassportId ?? "").trim();
  const signature = String(record.signature ?? "").trim();
  const nonce = String(record.nonce ?? "").trim();

  if (!delegationId || !parentPassportId) {
    return NextResponse.json(
      { error: "delegationId and parentPassportId are required" },
      { status: 400 },
    );
  }

  const parent = await prisma.agentPassport.findUnique({ where: { id: parentPassportId } });
  if (!parent) {
    return NextResponse.json({ error: "Parent passport not found" }, { status: 404 });
  }

  const delegation = await prisma.agentDelegation.findUnique({ where: { id: delegationId } });
  if (!delegation || delegation.parentPassportId !== parentPassportId) {
    return NextResponse.json({ error: "Delegation not found" }, { status: 404 });
  }
  if (!delegation.active) {
    return NextResponse.json({ error: "Delegation already revoked" }, { status: 409 });
  }

  const chain = normalizeVerificationChain(parent.ownerWalletChain) ?? "solana";

  if (!signature) {
    const expiresAt = new Date(Date.now() + challengeTtlMs());
    const challengeNonce = generateNonce();
    const message = buildRevokeDelegationMessage({
      ownerWallet: parent.ownerWallet,
      delegationId,
      nonce: challengeNonce,
    });
    await prisma.ownershipChallenge.create({
      data: {
        agentId: delegation.delegatedAgentId,
        walletAddress: parent.ownerWallet,
        chain,
        purpose: "revoke_delegation",
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
    });
  }

  if (!nonce) {
    return NextResponse.json({ error: "nonce is required with signature" }, { status: 400 });
  }

  const challenge = await prisma.ownershipChallenge.findUnique({ where: { nonce } });
  if (!challenge || challenge.purpose !== "revoke_delegation" || challenge.consumedAt) {
    return NextResponse.json({ error: "Invalid or consumed nonce" }, { status: 400 });
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
  }

  const message = buildRevokeDelegationMessage({
    ownerWallet: parent.ownerWallet,
    delegationId,
    nonce,
  });
  if (challenge.message !== message) {
    return NextResponse.json({ error: "Revocation message mismatch" }, { status: 400 });
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
  const updated = await prisma.$transaction(async (tx) => {
    await tx.ownershipChallenge.updateMany({
      where: { nonce, consumedAt: null },
      data: { consumedAt: now },
    });
    return tx.agentDelegation.update({
      where: { id: delegationId },
      data: { active: false, revokedAt: now },
    });
  });

  await prisma.verificationEvent.create({
    data: {
      passportId: parentPassportId,
      eventType: "delegation_revoked",
      detail: { delegationId },
    },
  });

  return NextResponse.json({ delegation: updated });
}
