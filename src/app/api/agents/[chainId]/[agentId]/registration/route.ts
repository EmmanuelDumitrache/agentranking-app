import { NextRequest, NextResponse } from "next/server";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import { prisma } from "@/lib/db";
import { buildAgentRegistrationFileJson } from "@/lib/agent-solana-registration/registration-file";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const { chainId, agentId: rawAgentId } = await params;
  const chainIdNum = parsePublicChainId(chainId);
  const agentIdNum = parsePublicAgentId(rawAgentId);
  if (chainIdNum == null || agentIdNum == null) {
    return NextResponse.json({ error: "Invalid agent identity" }, { status: 400, headers: CORS_HEADERS });
  }

  const agent = await prisma.agent.findFirst({
    where: { chainId: chainIdNum, agentId: agentIdNum, isActive: true },
    select: { id: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404, headers: CORS_HEADERS });
  }

  const payload = await buildAgentRegistrationFileJson(agent.id);
  if (!payload) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404, headers: CORS_HEADERS });
  }

  return NextResponse.json(payload, { headers: CORS_HEADERS });
}
