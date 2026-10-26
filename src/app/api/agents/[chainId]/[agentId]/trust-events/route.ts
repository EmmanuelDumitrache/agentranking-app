import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
type RouteParams = { params: Promise<{ chainId: string; agentId: string }> };
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { chainId: chainIdStr, agentId: agentIdStr } = await params;
  const chainId = parsePublicChainId(chainIdStr);
  const agentId = parsePublicAgentId(agentIdStr);
  if (chainId == null || agentId == null) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }
  const agent = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: { id: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  const events = await prisma.trustEvent.findMany({
    where: { agentId: agent.id },
    orderBy: { timestamp: "desc" },
    take: 25,
    select: {
      id: true,
      eventType: true,
      scoreDelta: true,
      evidenceUrl: true,
      onChainTx: true,
      timestamp: true,
    },
  });
  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      scoreDelta: e.scoreDelta,
      evidenceUrl: e.evidenceUrl,
      onChainTx: e.onChainTx,
      createdAt: e.timestamp.toISOString(),
    })),
  });
}
