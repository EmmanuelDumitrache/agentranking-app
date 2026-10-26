import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizeForPostgres } from "@/lib/utils";
import { requireDashboardAgentForMcp } from "@/lib/dashboard/agent-mcp-access";
import {
  MCP_OFFER_CTA_MAX,
  MCP_OFFER_PRICE_MAX,
  MCP_OFFER_SUMMARY_MAX,
  MCP_OFFER_TITLE_MAX,
  serializeMcpOffer,
} from "@/lib/mcp-offers-api-shared";
import { revalidateAgentPublicCache } from "@/lib/revalidate-agent-public-cache";
export const dynamic = "force-dynamic";
async function revalidateAgentByDbId(agentDbId: number) {
  const pub = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { chainId: true, agentId: true, name: true },
  });
  if (pub) await revalidateAgentPublicCache(pub.chainId, pub.agentId, pub.name);
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; offerId: string }> },
) {
  const { agentDbId: agentDbIdRaw, offerId } = await params;
  const agentDbId = Number.parseInt(agentDbIdRaw, 10);
  const oid = Number.parseInt(offerId, 10);
  if (!Number.isFinite(agentDbId) || !Number.isFinite(oid)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireDashboardAgentForMcp(agentDbId);
  if (!access.ok) return access.response;
  const existing = await prisma.agentMcpOffer.findFirst({
    where: { id: oid, agentId: agentDbId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const data: {
    title?: string;
    summary?: string;
    priceLabel?: string;
    ctaUrl?: string;
    sortOrder?: number;
    isPublished?: boolean;
    linkedServiceId?: number | null;
  } = {};
  if (body.title !== undefined) {
    const t = sanitizeForPostgres(String(body.title).trim().slice(0, MCP_OFFER_TITLE_MAX));
    if (!t) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    data.title = t;
  }
  if (body.summary !== undefined) {
    data.summary = sanitizeForPostgres(String(body.summary).trim().slice(0, MCP_OFFER_SUMMARY_MAX));
  }
  if (body.priceLabel !== undefined) {
    data.priceLabel = sanitizeForPostgres(String(body.priceLabel).trim().slice(0, MCP_OFFER_PRICE_MAX));
  }
  if (body.ctaUrl !== undefined) {
    data.ctaUrl = sanitizeForPostgres(String(body.ctaUrl).trim().slice(0, MCP_OFFER_CTA_MAX));
  }
  if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
    data.sortOrder = Number(body.sortOrder);
  }
  if (body.isPublished !== undefined) {
    data.isPublished = body.isPublished === true;
  }
  if (body.linkedServiceId !== undefined) {
    if (body.linkedServiceId === null || body.linkedServiceId === "") {
      data.linkedServiceId = null;
    } else {
      const sid = Number(body.linkedServiceId);
      if (!Number.isFinite(sid)) {
        return NextResponse.json({ error: "Invalid linkedServiceId" }, { status: 400 });
      }
      const svc = await prisma.agentService.findFirst({
        where: { id: sid, agentId: agentDbId },
      });
      if (!svc) {
        return NextResponse.json({ error: "linkedServiceId not found for this agent" }, { status: 400 });
      }
      data.linkedServiceId = sid;
    }
  }
  const updated = await prisma.agentMcpOffer.update({
    where: { id: oid },
    data,
    include: {
      linkedService: { select: { id: true, name: true, endpoint: true } },
    },
  });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ offer: serializeMcpOffer(updated) });
}
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; offerId: string }> },
) {
  const { agentDbId: agentDbIdRaw, offerId } = await params;
  const agentDbId = Number.parseInt(agentDbIdRaw, 10);
  const oid = Number.parseInt(offerId, 10);
  if (!Number.isFinite(agentDbId) || !Number.isFinite(oid)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const access = await requireDashboardAgentForMcp(agentDbId);
  if (!access.ok) return access.response;
  const existing = await prisma.agentMcpOffer.findFirst({
    where: { id: oid, agentId: agentDbId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  await prisma.agentMcpOffer.delete({ where: { id: oid } });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ success: true });
}
