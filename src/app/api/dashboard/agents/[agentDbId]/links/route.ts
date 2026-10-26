import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { upsertAgentSignals } from "@/lib/signals/store";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import { loadDashboardAgentEditorLinks } from "@/lib/dashboard/agent-detail";
import {
  isOfficialLinkType,
  metadataKeysForLinkType,
  type OfficialLinkType,
} from "@/lib/dashboard/official-links";
export const dynamic = "force-dynamic";
async function upsertAgentMetadata(agentId: number, key: string, value: string) {
  const existing = await prisma.agentMetadata.findFirst({ where: { agentId, key } });
  if (existing) {
    await prisma.agentMetadata.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.agentMetadata.create({ data: { agentId, key, value } });
  }
}
async function deleteAgentMetadata(agentId: number, keys: string[]) {
  if (keys.length === 0) return;
  await prisma.agentMetadata.deleteMany({
    where: { agentId, key: { in: keys } },
  });
}
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const links = await loadDashboardAgentEditorLinks(agentDbId);
  if (!links) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(links);
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
  const body = (await request.json()) as {
    links?: Array<{ linkType: string; url: string; lock?: boolean }>;
    lockAll?: boolean;
  };
  const links = body.links ?? [];
  for (const row of links) {
    if (!isOfficialLinkType(row.linkType)) continue;
    const linkType = row.linkType as OfficialLinkType;
    const url = row.url.trim();
    const metadataKeys = metadataKeysForLinkType(linkType);
    if (!url) {
      await prisma.agentOfficialLink.deleteMany({
        where: { agentId: agentDbId, linkType },
      });
      await deleteAgentMetadata(agentDbId, metadataKeys);
      continue;
    }
    await prisma.agentOfficialLink.upsert({
      where: { agentId_linkType: { agentId: agentDbId, linkType } },
      create: {
        agentId: agentDbId,
        linkType,
        url,
        status: "submitted",
        lockedByVerifiedOwner: Boolean(body.lockAll || row.lock),
      },
      update: {
        url,
        status: "submitted",
        lockedByVerifiedOwner: Boolean(body.lockAll || row.lock),
      },
    });
    for (const key of metadataKeys) {
      await upsertAgentMetadata(agentDbId, key, url);
    }
  }
  if (body.lockAll) {
    await upsertAgentMetadata(agentDbId, "officialLinksLocked", "true");
    await upsertAgentSignals(agentDbId, [
      {
        signalType: "official_links_locked",
        status: "verified",
        source: "user_submission",
        confidence: "high",
        verifiedAt: new Date(),
      },
    ]);
  }
  const updated = await prisma.agentOfficialLink.findMany({ where: { agentId: agentDbId } });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ links: updated });
}
