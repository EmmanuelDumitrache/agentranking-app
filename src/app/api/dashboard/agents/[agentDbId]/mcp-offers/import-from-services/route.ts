import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizeForPostgres } from "@/lib/utils";
import { requireDashboardAgentForMcp } from "@/lib/dashboard/agent-mcp-access";
import { revalidateAgentPublicCache } from "@/lib/revalidate-agent-public-cache";
export const dynamic = "force-dynamic";
function isMcpServiceName(name: string): boolean {
  return name.trim().toUpperCase() === "MCP";
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
  let body: { serviceIds?: number[] } = {};
  try {
    body = (await request.json()) as { serviceIds?: number[] };
  } catch {
    body = {};
  }
  const services = await prisma.agentService.findMany({
    where: { agentId: agentDbId },
    orderBy: { id: "asc" },
  });
  const mcpServices = services.filter((s) => isMcpServiceName(s.name));
  const idFilter =
    Array.isArray(body.serviceIds) && body.serviceIds.length > 0
      ? new Set(body.serviceIds.filter((n) => Number.isFinite(n)))
      : null;
  const toImport = idFilter
    ? mcpServices.filter((s) => idFilter.has(s.id))
    : mcpServices;
  const existingLinked = new Set(
    (
      await prisma.agentMcpOffer.findMany({
        where: { agentId: agentDbId, linkedServiceId: { not: null } },
        select: { linkedServiceId: true },
      })
    )
      .map((r) => r.linkedServiceId)
      .filter((x): x is number => x != null),
  );
  const created: { id: number; linkedServiceId: number | null }[] = [];
  let sortBase =
    (
      await prisma.agentMcpOffer.aggregate({
        where: { agentId: agentDbId },
        _max: { sortOrder: true },
      })
    )._max.sortOrder ?? 0;
  for (const svc of toImport) {
    if (existingLinked.has(svc.id)) continue;
    sortBase += 1;
    const endpointSnippet = sanitizeForPostgres(svc.endpoint.trim().slice(0, 120));
    const title = sanitizeForPostgres(`${svc.name} — ${endpointSnippet || "endpoint"}`.slice(0, 200));
    const summary = sanitizeForPostgres(
      svc.endpoint ? `Linked endpoint: ${svc.endpoint.trim().slice(0, 400)}` : "",
    ).slice(0, 500);
    const row = await prisma.agentMcpOffer.create({
      data: {
        agentId: agentDbId,
        title: title || "MCP",
        summary,
        priceLabel: "",
        ctaUrl: "",
        linkedServiceId: svc.id,
        sortOrder: sortBase,
        isPublished: true,
      },
    });
    created.push({ id: row.id, linkedServiceId: row.linkedServiceId });
  }
  if (created.length > 0) {
    const pub = await prisma.agent.findUnique({
      where: { id: agentDbId },
      select: { chainId: true, agentId: true, name: true },
    });
    if (pub) await revalidateAgentPublicCache(pub.chainId, pub.agentId, pub.name);
  }
  return NextResponse.json({
    imported: created.length,
    offerIds: created.map((c) => c.id),
  });
}
