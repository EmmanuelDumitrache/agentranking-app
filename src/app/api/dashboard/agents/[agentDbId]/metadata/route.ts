import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import {
  buildServiceMetadataSnapshot,
  isEditableServiceMetadataKey,
  normalizeMetadataItemsInput,
  serializeMetadataStringArray,
} from "@/lib/dashboard/service-metadata";
export const dynamic = "force-dynamic";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const metadata = await prisma.agentMetadata.findMany({
    where: {
      agentId: agentDbId,
      key: { in: ["mcpTools", "a2aSkills", "oasfSkills"] },
    },
    select: { key: true, value: true },
  });
  return NextResponse.json({ metadata: buildServiceMetadataSnapshot(metadata) });
}
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const body = (await request.json()) as { key?: string; items?: string[] };
  const key = body.key?.trim();
  if (!key || !isEditableServiceMetadataKey(key)) {
    return NextResponse.json({ error: "Invalid metadata key" }, { status: 400 });
  }
  const items = normalizeMetadataItemsInput(body.items ?? []);
  const value = serializeMetadataStringArray(items);
  const existing = await prisma.agentMetadata.findFirst({
    where: { agentId: agentDbId, key },
    select: { id: true },
  });
  if (existing) {
    await prisma.agentMetadata.update({
      where: { id: existing.id },
      data: { value },
    });
  } else if (items.length > 0) {
    await prisma.agentMetadata.create({
      data: { agentId: agentDbId, key, value },
    });
  }
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({
    metadata: buildServiceMetadataSnapshot([{ key, value }]),
  });
}