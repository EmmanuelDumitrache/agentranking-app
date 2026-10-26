import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hash } from "node:crypto";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import { invalidatePublicReputationStatistics } from "@/lib/invalidate-public-statistics";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ chainId: string; agentId: string }> };
function getIpHash(request: NextRequest, agentId: number): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return hash("sha256", `${ip}:${agentId}:${today}`, "hex");
}
/**
 * POST /api/agents/[chainId]/[agentId]/vote
 * Body: { voteType: "fire" | "poo" }
 * Rate limit: 1 vote per IP per agent per day (fire OR poo, not both).
 * Records one fire or poo community signal per IP and agent per UTC day.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { chainId: chainIdStr, agentId: agentIdStr } = await params;
    const chainId = parsePublicChainId(chainIdStr);
    const agentId = parsePublicAgentId(agentIdStr);
    if (chainId == null || agentId == null) {
      return NextResponse.json({ error: "Invalid chainId or agentId" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const voteType = body.voteType as string;
    if (voteType !== "fire" && voteType !== "poo") {
      return NextResponse.json({ error: "voteType must be 'fire' or 'poo'" }, { status: 400 });
    }
    const agent = await prisma.agent.findFirst({
      where: { agentId, chainId },
      select: { id: true },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const ipHash = getIpHash(request, agent.id);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-vote:${agent.id}:${ipHash}`}, 0))`;
      const existingVote = await tx.agentVote.findFirst({
        where: { agentId: agent.id, ipHash },
        select: { voteType: true },
      });
      if (existingVote) {
        return { alreadyVoted: true as const, voteType: existingVote.voteType };
      }
      await tx.agentVote.create({
        data: { agentId: agent.id, ipHash, voteType },
      });
      const updated = await tx.agent.update({
        where: { id: agent.id },
        data: voteType === "fire"
          ? { voteFireCount: { increment: 1 } }
          : { votePooCount: { increment: 1 } },
        select: { voteFireCount: true, votePooCount: true, powerScore: true },
      });
      return { alreadyVoted: false as const, updated };
    });
    if (result.alreadyVoted) {
      return NextResponse.json(
        { error: "Already voted today", alreadyVoted: true, voteType: result.voteType },
        { status: 429 },
      );
    }
    await invalidatePublicReputationStatistics();
    return NextResponse.json({
      ok: true,
      voteFireCount: result.updated.voteFireCount,
      votePooCount: result.updated.votePooCount,
      powerScore: result.updated.powerScore,
    });
  } catch (err) {
    console.error("POST vote error:", err);
    return NextResponse.json({ error: "Failed to record vote" }, { status: 500 });
  }
}
/**
 * GET /api/agents/[chainId]/[agentId]/vote
 * Returns current vote counts + whether this IP has voted today.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { chainId: chainIdStr, agentId: agentIdStr } = await params;
    const chainId = parsePublicChainId(chainIdStr);
    const agentId = parsePublicAgentId(agentIdStr);
    if (chainId == null || agentId == null) {
      return NextResponse.json({ error: "Invalid chainId or agentId" }, { status: 400 });
    }
    const agent = await prisma.agent.findFirst({
      where: { agentId, chainId },
      select: { id: true, voteFireCount: true, votePooCount: true, powerScore: true },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const ipHash = getIpHash(request, agent.id);
    const existingVote = await prisma.agentVote.findFirst({
      where: { agentId: agent.id, ipHash },
    });
    return NextResponse.json({
      voteFireCount: agent.voteFireCount,
      votePooCount: agent.votePooCount,
      powerScore: agent.powerScore,
      hasVoted: !!existingVote,
      voteType: existingVote?.voteType ?? null,
    });
  } catch (err) {
    console.error("GET vote error:", err);
    return NextResponse.json({ error: "Failed to fetch vote data" }, { status: 500 });
  }
}
