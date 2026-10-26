import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildOwnershipMessage,
  challengeTtlMs,
  generateNonce,
  normalizeVerificationChain,
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
  const chain = normalizeVerificationChain(chainRaw);

  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "agentId must be a positive integer (Agent.id)" }, { status: 400 });
  }
  if (!walletAddress) {
    return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
  }
  if (!chain) {
    return NextResponse.json({ error: "chain must be solana or evm" }, { status: 400 });
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const expiresAt = new Date(Date.now() + challengeTtlMs());
  const nonce = generateNonce();
  const message = buildOwnershipMessage({
    agentId,
    walletAddress,
    nonce,
    expiresIso: expiresAt.toISOString(),
  });

  await prisma.ownershipChallenge.create({
    data: {
      agentId,
      walletAddress,
      chain,
      purpose: "ownership",
      nonce,
      message,
      expiresAt,
    },
  });

  return NextResponse.json({
    agentId,
    walletAddress,
    chain,
    nonce,
    message,
    expiresAt: expiresAt.toISOString(),
  });
}
