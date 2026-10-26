import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  assertDashboardAgentAccess,
  getDashboardAccess,
} from "@/lib/dashboard/access";
import { loadDashboardAgentDetail } from "@/lib/dashboard/agent-detail";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { enqueueAgentSignalSync } from "@/jobs/producer";
import { revalidateAgentPublicCache } from "@/lib/revalidate-agent-public-cache";
import { sanitizeForPostgres } from "@/lib/utils";
import { normalizeStoredAgentImageUrl } from "@/lib/image-utils";
export const dynamic = "force-dynamic";
const ALLOWED_ARCHETYPES = [
  "trading",
  "arbitrage",
  "sniper",
  "yield",
  "builder",
  "analytics",
  "bridge",
  "copy_trader",
  "social",
  "mev",
  "telegram",
  "",
] as const;
type AgentRouteContext = {
  params: Promise<{ agentDbId: string }>;
};
async function parseAgentDbId(context: AgentRouteContext): Promise<number | null> {
  const { agentDbId } = await context.params;
  const parsed = Number.parseInt(agentDbId, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
export async function GET(_request: NextRequest, context: AgentRouteContext) {
  const agentDbId = await parseAgentDbId(context);
  if (agentDbId == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  const payload = await loadDashboardAgentDetail(agentDbId);
  if (!payload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(payload);
}
export async function PATCH(request: NextRequest, context: AgentRouteContext) {
  const agentDbId = await parseAgentDbId(context);
  if (agentDbId == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  const body = (await request.json()) as {
    name?: string;
    description?: string;
    archetype?: string;
    tokenAddress?: string;
    image?: string;
  };
  const updateData: Prisma.AgentUpdateInput = {};
  if (body.name !== undefined) {
    const name = sanitizeForPostgres(String(body.name).trim().slice(0, 120));
    if (!name) {
      return NextResponse.json({ error: "Agent name is required" }, { status: 400 });
    }
    updateData.name = name;
  }
  if (body.description !== undefined) {
    updateData.description = sanitizeForPostgres(String(body.description).trim().slice(0, 2000));
  }
  if (body.image !== undefined) {
    updateData.image = sanitizeForPostgres(
      normalizeStoredAgentImageUrl(String(body.image)).slice(0, 1000),
    );
  }
  if (body.archetype !== undefined) {
    const archetype = String(body.archetype).trim().toLowerCase();
    if (!ALLOWED_ARCHETYPES.includes(archetype as (typeof ALLOWED_ARCHETYPES)[number])) {
      return NextResponse.json({ error: "Invalid archetype" }, { status: 400 });
    }
    updateData.archetype = archetype;
    updateData.archetypeAuto = false;
  }
  if (body.tokenAddress !== undefined) {
    const raw = String(body.tokenAddress).trim();
    updateData.tokenAddress = raw
      ? raw.startsWith("0x")
        ? raw.toLowerCase().slice(0, 42)
        : raw.slice(0, 44)
      : "";
  }
  if (Object.keys(updateData).length > 0) {
    await prisma.agent.update({ where: { id: agentDbId }, data: updateData });
  }
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { chainId: true, agentId: true, name: true },
  });
  if (agent) {
    await revalidateAgentPublicCache(
      agent.chainId,
      agent.agentId,
      agent.name,
      access.agent.name,
    );
  }
  await enqueueAgentSignalSync(agentDbId);
  const refreshed = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      name: true,
      description: true,
      image: true,
      archetype: true,
      tokenAddress: true,
    },
  });
  return NextResponse.json({ agent: refreshed });
}
export async function DELETE(_request: NextRequest, context: AgentRouteContext) {
  const agentDbId = await parseAgentDbId(context);
  if (agentDbId == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getDashboardAccess(session);
  const isOwner = access.ownedAgents.some((agent) => agent.id === agentDbId);
  if (!isOwner) {
    return NextResponse.json({ error: "You do not own this agent." }, { status: 403 });
  }
  const [launchedToken, agentToArchive] = await Promise.all([
    prisma.agentLaunch.findFirst({
      where: { agentDbId },
      select: { id: true },
    }),
    prisma.agent.findUnique({
      where: { id: agentDbId },
      select: { chainId: true, agentId: true, name: true },
    }),
  ]);
  const nextAgentId = access.ownedAgents
    .filter((agent) => agent.id !== agentDbId)
    .reduce<number | null>(
      (newestId, agent) => (newestId == null || agent.id > newestId ? agent.id : newestId),
      null,
    );
  await prisma.agent.update({
    where: { id: agentDbId },
    data: { administrativeActiveOverride: false, publiclyActive: false, isActive: false },
  });
  if (agentToArchive) {
    await revalidateAgentPublicCache(
      agentToArchive.chainId,
      agentToArchive.agentId,
      agentToArchive.name,
    );
  }
  return NextResponse.json({
    ok: true,
    hasToken: launchedToken != null,
    nextAgentId,
    redirectTo: nextAgentId ? `/dashboard/agents/${nextAgentId}` : "/dashboard",
  });
}
