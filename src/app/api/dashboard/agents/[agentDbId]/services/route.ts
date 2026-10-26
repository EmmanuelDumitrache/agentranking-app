import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertDashboardMcpAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import { loadDashboardServicesWorkspace } from "@/lib/dashboard/service-workspace.server";
import { normalizedAgentServiceData } from "@/lib/agent-service-normalization";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const agentDbId = Number.parseInt((await params).agentDbId, 10);
  const access = await assertDashboardMcpAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const workspace = await loadDashboardServicesWorkspace(agentDbId);
  if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    services: workspace.services,
    metadata: workspace.metadata,
    x402Support: workspace.x402Support,
    signals: workspace.signals,
    publicProfileHref: workspace.publicProfileHref,
    discovered: workspace.discovered,
  });
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardMcpAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const body = (await request.json()) as { name?: string; endpoint?: string; version?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const normalized = normalizedAgentServiceData({
    name,
    endpoint: body.endpoint?.trim() ?? "",
    version: body.version?.trim() ?? "",
  }, { sourceKind: "dashboard" });
  const service = await prisma.agentService.create({
    data: {
      agentId: agentDbId,
      ...normalized,
      extensions: normalized.extensions as never,
    },
  });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ service });
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardMcpAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const body = (await request.json()) as {
    id?: number;
    name?: string;
    endpoint?: string;
    version?: string;
  };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await prisma.agentService.findFirst({
    where: { id: body.id, agentId: agentDbId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const normalized = normalizedAgentServiceData({
    name: body.name?.trim() ?? existing.name,
    endpoint: body.endpoint?.trim() ?? existing.endpoint,
    version: body.version?.trim() ?? existing.version,
    skills: existing.skills,
    domains: existing.domains,
    capabilities: existing.capabilities,
    extensions: existing.extensions && typeof existing.extensions === "object" && !Array.isArray(existing.extensions)
      ? existing.extensions as Record<string, unknown>
      : {},
  }, { sourceKind: existing.sourceKind ?? "dashboard", sourceDigest: existing.sourceDigest });
  const service = await prisma.agentService.update({
    where: { id: body.id },
    data: {
      ...normalized,
      extensions: normalized.extensions as never,
    },
  });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ service });
}
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardMcpAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const id = Number.parseInt(request.nextUrl.searchParams.get("id") ?? "", 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await prisma.agentService.findFirst({ where: { id, agentId: agentDbId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.agentService.delete({ where: { id } });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ ok: true });
}
