import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { ensureMinimalUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
import {
  buildSapClaimMessage,
  isFreshClaimTimestamp,
  normalizeSolanaAddress,
  parseSapClaimMessage,
} from "@/lib/sap-claim-message";
import { verifySolanaSignMessage } from "@/lib/sap-claim-verify";
export const dynamic = "force-dynamic";
type Body = {
  agentDbId?: unknown;
  message?: unknown;
  signature?: unknown;
  publicKey?: unknown;
};
/**
 * POST /api/sap/claim
 * Body: { agentDbId, message, signature (base58), publicKey (base58) }
 * Message must equal buildSapClaimMessage(sapAgentPda, timestampIso) with fresh timestamp.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await ensureMinimalUserProfile(session);
  if (!resolved) {
    return NextResponse.json({ error: "No profile" }, { status: 400 });
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agentDbId = typeof body.agentDbId === "number" ? body.agentDbId : Number(body.agentDbId);
  const message = typeof body.message === "string" ? body.message : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const publicKey = typeof body.publicKey === "string" ? body.publicKey : "";
  if (!Number.isFinite(agentDbId) || !message || !signature || !publicKey) {
    return NextResponse.json(
      { error: "agentDbId, message, signature, and publicKey are required" },
      { status: 400 },
    );
  }
  const agent = await prisma.agent.findFirst({
    where: { id: agentDbId, sapVerified: true },
    select: {
      id: true,
      sapAgentPda: true,
      sapOwnerWallet: true,
    },
  });
  if (!agent?.sapAgentPda?.trim()) {
    return NextResponse.json({ error: "SAP agent not found" }, { status: 404 });
  }
  const ownerWallet = normalizeSolanaAddress(agent.sapOwnerWallet ?? "");
  const signerPk = normalizeSolanaAddress(publicKey);
  if (!ownerWallet || ownerWallet !== signerPk) {
    return NextResponse.json(
      { error: "publicKey must match the SAP owner wallet for this agent" },
      { status: 403 },
    );
  }
  const parsed = parseSapClaimMessage(message);
  if (!parsed || parsed.pda !== agent.sapAgentPda.trim()) {
    return NextResponse.json({ error: "Invalid message content" }, { status: 400 });
  }
  if (!isFreshClaimTimestamp(parsed.atMs)) {
    return NextResponse.json({ error: "Claim message expired — sign a fresh message" }, { status: 400 });
  }
  if (!verifySolanaSignMessage(message, signature, publicKey)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sap-claim-profile:${resolved.id}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sap-claim-agent:${agent.id}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sap-claim-wallet:${signerPk}`}, 0))`;
    const me = await tx.userProfile.findUnique({
      where: { id: resolved.id },
      select: { solanaWallet: true },
    });
    const existingSol = me?.solanaWallet?.trim();
    if (existingSol && existingSol !== signerPk) return "profile_wallet_conflict" as const;
    const otherProfile = await tx.userProfile.findFirst({
      where: { solanaWallet: signerPk, NOT: { id: resolved.id } },
      select: { id: true },
    });
    if (otherProfile) return "wallet_claimed" as const;
    const existing = await tx.sapAgentOperatorClaim.findUnique({
      where: { agentId: agent.id },
      select: { userProfileId: true },
    });
    if (existing && existing.userProfileId !== resolved.id) return "agent_claimed" as const;
    await tx.sapAgentOperatorClaim.upsert({
      where: { agentId: agent.id },
      create: {
        agentId: agent.id,
        userProfileId: resolved.id,
        solanaWallet: signerPk,
      },
      update: {
        userProfileId: resolved.id,
        solanaWallet: signerPk,
      },
    });
    await tx.userProfile.update({
      where: { id: resolved.id },
      data: { solanaWallet: signerPk },
    });
    await tx.agent.update({
      where: { id: agent.id },
      data: { isVerified: true },
    });
    return "claimed" as const;
  });
  if (claim === "profile_wallet_conflict") {
    return NextResponse.json(
      { error: "Your account already has a different Solana wallet linked" },
      { status: 409 },
    );
  }
  if (claim === "wallet_claimed") {
    return NextResponse.json(
      { error: "This Solana wallet is linked to another AgentRanking account" },
      { status: 409 },
    );
  }
  if (claim === "agent_claimed") {
    return NextResponse.json(
      { error: "This agent is already claimed by another account" },
      { status: 409 },
    );
  }
  await invalidateAllPublicStatistics();
  return NextResponse.json({
    success: true,
    agentId: agent.id,
    messageTemplate: buildSapClaimMessage(agent.sapAgentPda.trim(), new Date().toISOString()),
  });
}
