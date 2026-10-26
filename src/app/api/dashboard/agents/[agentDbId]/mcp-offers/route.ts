import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizeForPostgres } from "@/lib/utils";
import {
  agentCanPublishMcpOffers,
  requireDashboardAgentForMcp,
} from "@/lib/dashboard/agent-mcp-access";
import {
  MCP_OFFER_CTA_MAX,
  MCP_OFFER_PRICE_MAX,
  MCP_OFFER_SUMMARY_MAX,
  MCP_OFFER_TITLE_MAX,
  serializeMcpOffer,
} from "@/lib/mcp-offers-api-shared";
import { revalidateAgentPublicCache } from "@/lib/revalidate-agent-public-cache";
import { getMcpOffers } from "@/lib/agent-mcp-offers";
export const dynamic = "force-dynamic";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const { agentDbId: agentDbIdRaw } = await params;
  const agentDbId = Number.parseInt(agentDbIdRaw, 10);
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const access = await requireDashboardAgentForMcp(agentDbId);
  if (!access.ok) return access.response;
  const offers = await getMcpOffers(agentDbId, { includeUnpublished: true });
  return NextResponse.json({
    offers,
    canPublish: agentCanPublishMcpOffers(access.agent),
  });
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const { agentDbId: agentDbIdRaw } = await params;
  const agentDbId = Number.parseInt(agentDbIdRaw, 10);
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const access = await requireDashboardAgentForMcp(agentDbId);
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
  const isPublished = body.isPublished === true;
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
  const pub = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { chainId: true, agentId: true, name: true },
  });
  if (pub) await revalidateAgentPublicCache(pub.chainId, pub.agentId, pub.name);
  return NextResponse.json({ offer: serializeMcpOffer(created) });
}
