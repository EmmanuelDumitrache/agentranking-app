import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { buildAgentPassportPreview } from "@/lib/agent-launch/passport";
import { mergeDemoPassportOverrides } from "@/lib/agent-launch/demo-templates";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import { resolveLaunchAgentDbId } from "@/lib/agent-launch/linked-agent";
import {
  assertAgentLaunchDraftAccess,
  loadLaunchAccessContext,
} from "@/lib/launch-wallet-session/auth";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const body = (await request.json()) as {
    launchId?: string;
    agentName?: string;
    passportOverrides?: Record<string, unknown>;
  };
  const launchId = body.launchId?.trim();
  if (!launchId) {
    return NextResponse.json({ error: "launchId is required" }, { status: 400 });
  }
  const launch = await prisma.agentLaunch.findUnique({ where: { id: launchId } });
  if (!launch) {
    return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  const accessContext = await loadLaunchAccessContext(session);
  const access = await assertAgentLaunchDraftAccess(launch, accessContext);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  let agentName = body.agentName?.trim();
  if (!agentName) {
    const agentDbId = resolveLaunchAgentDbId(launch);
    if (agentDbId) {
      const agent = await prisma.agent.findUnique({
        where: { id: agentDbId },
        select: { name: true },
      });
      agentName = agent?.name;
    }
  }
  const passport = buildAgentPassportPreview({
    launch,
    agentName,
    passportOverrides: mergeDemoPassportOverrides(launch, body.passportOverrides),
  });
  await recordAgentLaunchEvent({
    launchId: launch.id,
    type: "passport_previewed",
    payloadJson: { schema: passport.schema },
  });
  return NextResponse.json({ passport });
}
