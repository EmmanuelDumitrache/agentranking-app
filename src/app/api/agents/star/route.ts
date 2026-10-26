import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/db";
import { invalidatePublicAgentProfileCaches } from "@/lib/invalidate-public-statistics";
import { requireLaunchWalletSessionForAddress } from "@/lib/launch-wallet-session/request-auth.server";
/**
 * GET /api/agents/star?agentId=<dbId>&wallet=<address>
 * Returns { starred: boolean, stars: number }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentId = Number(searchParams.get("agentId"));
  const wallet = (searchParams.get("wallet") || "").toLowerCase();
  if (!agentId || !isAddress(wallet)) {
    return NextResponse.json({ starred: false, stars: 0 });
  }
  const [existing, agent] = await Promise.all([
    prisma.agentStar.findUnique({
      where: { agentId_walletAddress: { agentId, walletAddress: wallet } },
    }),
    prisma.agent.findUnique({ where: { id: agentId }, select: { stars: true } }),
  ]);
  return NextResponse.json({
    starred: Boolean(existing),
    stars: agent?.stars ?? 0,
  });
}
/**
 * POST /api/agents/star
 * Body: { agentId: number, wallet: string }
 * Toggles star on/off. Returns { starred: boolean, stars: number }
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agentId = Number(body.agentId);
  const wallet = (typeof body.wallet === "string" ? body.wallet : "").toLowerCase();
  if (!agentId || !isAddress(wallet)) {
    return NextResponse.json({ error: "A valid agentId and EVM wallet are required" }, { status: 400 });
  }
  const access = await requireLaunchWalletSessionForAddress(request, "evm", wallet);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, code: "WALLET_SESSION_REQUIRED" },
      { status: access.status },
    );
  }
  const authenticatedWallet = access.wallet.toLowerCase();
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-star:${agentId}:${authenticatedWallet}`}, 0))`;
    const agent = await tx.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });
    if (!agent) return null;
    const existing = await tx.agentStar.findUnique({
      where: { agentId_walletAddress: { agentId, walletAddress: authenticatedWallet } },
      select: { id: true },
    });
    if (existing) {
      await tx.agentStar.delete({ where: { id: existing.id } });
      const stars = await tx.agentStar.count({ where: { agentId } });
      await tx.agent.update({
        where: { id: agentId },
        data: { stars },
      });
      return { starred: false, stars };
    }
    await tx.agentStar.create({ data: { agentId, walletAddress: authenticatedWallet } });
    const stars = await tx.agentStar.count({ where: { agentId } });
    await tx.agent.update({
      where: { id: agentId },
      data: { stars },
    });
    return { starred: true, stars };
  });
  if (!result) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  await invalidatePublicAgentProfileCaches();
  return NextResponse.json(result);
}
