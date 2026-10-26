import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { verifyMessage } from "viem";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { prisma } from "@/lib/db";
import { invalidatePublicAgentProfileCaches } from "@/lib/invalidate-public-statistics";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
/**
 * POST /api/verified-revenue/verify-signature
 * Submits a signed nonce to complete wallet linking.
 * Body: { challengeId: string, signature: string }
 *
 * On success: Agent.verifiedWallet is set and the challenge is consumed.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!hasDashboardSessionIdentity(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json() as {
      challengeId?: string;
      signature?: string;
    };
    const challengeId = (body.challengeId as string)?.trim();
    const signature = (body.signature as string)?.trim() as `0x${string}` | undefined;
    if (!challengeId || !signature) {
      return NextResponse.json(
        { error: "Missing required fields: challengeId, signature" },
        { status: 400 }
      );
    }
    const challenge = await prisma.walletLinkChallenge.findUnique({
      where: { id: challengeId },
    });
    if (!challenge) {
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    }
    const access = await getDashboardAccess(session);
    if (!access.ownedAgents.some((agent) => agent.id === challenge.agentId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (challenge.usedAt) {
      return NextResponse.json({ error: "Challenge already used" }, { status: 400 });
    }
    if (challenge.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
    }
    const message = `Sign to link execution wallet ${challenge.wallet} to AgentRanking agent #${challenge.agentId}: ${challenge.nonce}`;
    try {
      const recovered = await verifyMessage({
        address: challenge.wallet as `0x${string}`,
        message,
        signature,
      });
      if (!recovered) {
        return NextResponse.json({ error: "Signature does not match the execution wallet" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    const linked = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-link:${challenge.agentId}`}, 0))`;
      const current = await tx.walletLinkChallenge.findUnique({ where: { id: challengeId } });
      if (!current || current.usedAt || current.expiresAt <= new Date()) return false;
      await tx.walletLinkChallenge.update({
        where: { id: challengeId },
        data: { usedAt: new Date() },
      });
      await tx.agent.update({
        where: { id: challenge.agentId },
        data: {
          verifiedWallet: challenge.wallet,
          verifiedWalletAt: new Date(),
        },
      });
      return true;
    });
    if (!linked) {
      return NextResponse.json({ error: "Challenge expired or already used" }, { status: 409 });
    }
    await invalidatePublicAgentProfileCaches();
    return NextResponse.json({ success: true, verifiedWallet: challenge.wallet });
  } catch (err) {
    console.error("POST /api/verified-revenue/verify-signature error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
