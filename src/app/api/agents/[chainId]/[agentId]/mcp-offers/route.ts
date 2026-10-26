import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { prismaApiErrorLogFields, prismaApiRouteErrorResponse } from "@/lib/api-prisma-route-error";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
export const maxDuration = 30;
function serializePublicOffer(o: {
  id: number;
  title: string;
  summary: string;
  priceLabel: string;
  ctaUrl: string;
  linkedServiceId: number | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  linkedService: { id: number; name: string; endpoint: string } | null;
}) {
  return {
    id: o.id,
    title: o.title,
    summary: o.summary,
    priceLabel: o.priceLabel,
    ctaUrl: o.ctaUrl,
    sortOrder: o.sortOrder,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    linkedService: o.linkedService,
  };
}
/**
 * GET /api/agents/[chainId]/[agentId]/mcp-offers
 * agentId = on-chain numeric agent id. Returns published offers for the agent (no KYA gate).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const { chainId: chainIdStr, agentId: agentIdStr } = await params;
  try {
    const chainId = parsePublicChainId(chainIdStr);
    const agentId = parsePublicAgentId(agentIdStr);
    if (chainId == null || agentId == null) {
      return NextResponse.json({ error: "Invalid chainId or agentId" }, { status: 400 });
    }
    const agent = await prisma.agent.findUnique({
      where: { agentId_chainId: { agentId, chainId } },
      select: { id: true },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const offers = await prisma.agentMcpOffer.findMany({
      where: { agentId: agent.id, isPublished: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: {
        linkedService: { select: { id: true, name: true, endpoint: true } },
      },
    });
    return NextResponse.json(
      {
        offers: offers.map(serializePublicOffer),
        hasPublishedMcpOffers: offers.length > 0,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("GET /api/agents/.../mcp-offers error:", {
      error: msg,
      stack: Error.isError(err) ? err.stack : undefined,
      ...prismaApiErrorLogFields(msg),
    });
    const { body, status, headers } = prismaApiRouteErrorResponse(msg);
    return NextResponse.json(body, { status, headers });
  }
}
