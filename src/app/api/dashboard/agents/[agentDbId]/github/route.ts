import { NextRequest, NextResponse } from "next/server";
import { randomUUIDv7 } from "@/lib/uuid-v7";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadDashboardGithubRouteData } from "@/lib/dashboard/github-data.server";
import { assertDashboardAgentAccess, getDashboardAccess } from "@/lib/dashboard/access";
import { normalizeGithubRepoFullName } from "@/lib/dashboard/github-repo-parse";
import { syncGithubConnectionForAgent } from "@/lib/dashboard/github-sync";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
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
  const data = await loadDashboardGithubRouteData(agentDbId);
  return NextResponse.json(data);
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const dashboardAccess = await getDashboardAccess(session);
  const body = (await request.json()) as { repoFullName?: string; visibility?: string };
  const repoFullName = normalizeGithubRepoFullName(body.repoFullName ?? "");
  if (!repoFullName) {
    return NextResponse.json(
      { error: "Enter a valid GitHub repo as owner/repo or a github.com URL" },
      { status: 400 },
    );
  }
  const connection = await prisma.agentGithubConnection.create({
    data: {
      id: randomUUIDv7(),
      agentId: agentDbId,
      repoFullName,
      visibility: body.visibility?.trim() || "public",
      connectedByUserId: dashboardAccess.profileId,
      status: "pending",
    },
  });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({
    connection,
    installUrl: process.env.GITHUB_APP_INSTALL_URL ?? "https://github.com/apps/agentranking-devproof/installations/new",
    message: "GitHub App install required before sync can run.",
  });
}
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  try {
    const connection = await prisma.agentGithubConnection.findFirst({
      where: { agentId: agentDbId, status: { in: ["pending", "active"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!connection) {
      return NextResponse.json({ error: "No GitHub connection" }, { status: 404 });
    }
    const normalized = normalizeGithubRepoFullName(connection.repoFullName);
    if (!normalized) {
      return NextResponse.json(
        {
          error:
            "Stored repo is invalid. Reconnect using owner/repo (e.g. owner/example-agent-repository).",
        },
        { status: 400 },
      );
    }
    if (normalized !== connection.repoFullName) {
      await prisma.agentGithubConnection.update({
        where: { id: connection.id },
        data: { repoFullName: normalized },
      });
    }
    const { connection: updated, snapshot } = await syncGithubConnectionForAgent(
      agentDbId,
      connection.id,
    );
    try {
      await revalidateAgentByDbId(agentDbId);
    } catch (revalidateErr) {
      console.error("[github-sync] revalidate failed", revalidateErr);
    }
    return NextResponse.json({ connection: updated, snapshot });
  } catch (err) {
    const message = Error.isError(err) ? err.message : "GitHub sync failed";
    console.error("[github-sync] PATCH failed", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
