import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

async function requireAgentOwner(agentId: number): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getDashboardAccess(session);
  if (!access.ownedAgents.some((agent) => agent.id === agentId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * POST /api/verified-revenue/link-wallet
 * Initiates a wallet-link challenge for an Agent owned by the signed-in user.
 * Body: { agentId: number, executionWallet: string }
 *
 * GET /api/verified-revenue/link-wallet?agentId=N
 * Returns current link status for an agent.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      agentId?: number;
      executionWallet?: string;
    };
    const agentId = Number(body.agentId);
    const executionWallet = (body.executionWallet as string)?.trim().toLowerCase();
    if (!agentId || !executionWallet) {
      return NextResponse.json(
        { error: "Missing required fields: agentId, executionWallet" },
        { status: 400 }
      );
    }
    if (!/^0x[0-9a-f]{40}$/i.test(executionWallet)) {
      return NextResponse.json({ error: "executionWallet must be a valid EVM address" }, { status: 400 });
    }
    const ownershipError = await requireAgentOwner(agentId);
    if (ownershipError) return ownershipError;

    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const challenge = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-link:${agentId}`}, 0))`;
      const agent = await tx.agent.findUnique({ where: { id: agentId }, select: { id: true } });
      if (!agent) return null;
      await tx.walletLinkChallenge.updateMany({
        where: { agentId, usedAt: null, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });
      return tx.walletLinkChallenge.create({
        data: { agentId, wallet: executionWallet, nonce, expiresAt },
      });
    });
    if (!challenge) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const message = `Sign to link execution wallet ${executionWallet} to AgentRanking agent #${agentId}: ${nonce}`;
    return NextResponse.json({
      challengeId: challenge.id,
      nonce,
      message,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("POST /api/verified-revenue/link-wallet error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
export async function GET(request: NextRequest) {
  const agentId = Number(request.nextUrl.searchParams.get("agentId"));
  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }
  const ownershipError = await requireAgentOwner(agentId);
  if (ownershipError) return ownershipError;
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      verifiedWallet: true,
      verifiedWalletAt: true,
      verifiedWalletChainId: true,
      isVerifiedRevenue: true,
      verifiedRevenueAt: true,
    },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  return NextResponse.json({
    walletLinked: agent.verifiedWallet !== "",
    verifiedWallet: agent.verifiedWallet || null,
    verifiedWalletAt: agent.verifiedWalletAt?.toISOString() ?? null,
    verifiedWalletChainId: agent.verifiedWalletChainId ?? null,
    isVerifiedRevenue: agent.isVerifiedRevenue,
    verifiedRevenueAt: agent.verifiedRevenueAt?.toISOString() ?? null,
  });
}
