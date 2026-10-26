import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import {
  applyLaunchProfileEnrichment,
  sanitizeLaunchProfileEnrichmentInput,
} from "@/lib/agent-launch/apply-launch-profile-enrichment.server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const agentDbId = Number.parseInt((await params).agentDbId, 10);
  if (!Number.isFinite(agentDbId) || agentDbId <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  let input;
  try {
    input = sanitizeLaunchProfileEnrichmentInput(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid profile enrichment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const launchId =
    typeof body.launchId === "string" && body.launchId.trim() ? body.launchId.trim() : null;
  if (launchId) {
    const launch = await prisma.agentLaunch.findFirst({
      where: { id: launchId, agentDbId },
      select: { id: true },
    });
    if (!launch) {
      return NextResponse.json({ error: "Launch not found for this agent" }, { status: 404 });
    }
  }
  await applyLaunchProfileEnrichment(agentDbId, launchId, input);
  return NextResponse.json({ ok: true });
}
