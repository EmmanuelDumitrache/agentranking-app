import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizeForPostgres } from "@/lib/utils";
import {
  MCP_OFFER_CTA_MAX,
  MCP_OFFER_PRICE_MAX,
  MCP_OFFER_SUMMARY_MAX,
  MCP_OFFER_TITLE_MAX,
  serializeMcpOffer,
} from "@/lib/mcp-offers-api-shared";
import { revalidateAgentPublicCache } from "@/lib/revalidate-agent-public-cache";
import { requireAdminAgentForMcp } from "@/lib/admin-agent-mcp-api";
import { agentCanPublishMcpOffers } from "@/lib/dashboard/agent-mcp-access";
export const dynamic = "force-dynamic";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agentDbId = Number.parseInt(id, 10);
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const access = await requireAdminAgentForMcp(agentDbId);
  if (!access.ok) return access.response;
  const offers = await prisma.agentMcpOffer.findMany({
    where: { agentId: agentDbId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      linkedService: { select: { id: true, name: true, endpoint: true } },
    },
  });
  return NextResponse.json({
    offers: offers.map(serializeMcpOffer),
    canPublish: agentCanPublishMcpOffers(access.agent),
  });
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agentDbId = Number.parseInt(id, 10);
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const access = await requireAdminAgentForMcp(agentDbId);
  if (!access.ok) return access.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const title = sanitizeForPostgres(String(body.title ?? "").trim().slice(0, MCP_OFFER_TITLE_MAX));
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const summary = sanitizeForPostgres(String(body.summary ?? "").trim().slice(0, MCP_OFFER_SUMMARY_MAX));
  const priceLabel = sanitizeForPostgres(String(body.priceLabel ?? "").trim().slice(0, MCP_OFFER_PRICE_MAX));
  const ctaUrl = sanitizeForPostgres(String(body.ctaUrl ?? "").trim().slice(0, MCP_OFFER_CTA_MAX));
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
  // Admin-created rows are public by default; send isPublished: false for an intentional private draft.
  const isPublished =
    body.isPublished === false ? false : agentCanPublishMcpOffers(access.agent);
  let linkedServiceId: number | null = null;
  if (body.linkedServiceId != null && body.linkedServiceId !== "") {
    const sid = Number(body.linkedServiceId);
    if (Number.isFinite(sid)) {
      const svc = await prisma.agentService.findFirst({
        where: { id: sid, agentId: agentDbId },
      });
      if (!svc) {
        return NextResponse.json({ error: "linkedServiceId not found for this agent" }, { status: 400 });
      }
      linkedServiceId = sid;
    }
  }
  const created = await prisma.agentMcpOffer.create({
    data: {
      agentId: agentDbId,
      title,
      summary,
      priceLabel,
      ctaUrl,
      linkedServiceId,
      sortOrder,
      isPublished,
    },
    include: {
      linkedService: { select: { id: true, name: true, endpoint: true } },
    },
  });
  await revalidateAgentPublicCache(access.agent.chainId, access.agent.agentId, access.agent.name);
  return NextResponse.json({ offer: serializeMcpOffer(created) });
}
