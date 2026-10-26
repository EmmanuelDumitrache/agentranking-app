import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  assertMetaplexLaunchAttemptAccess,
  loadMetaplexLaunchAttemptForAgent,
} from "@/lib/metaplex-launch/attempt-store.server";
import { serializeMetaplexLaunchAttempt } from "@/lib/metaplex-launch/serialize";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);

  const session = await getServerSession(authOptions);
  const agentDbId = Number.parseInt(
    request.nextUrl.searchParams.get("agentDbId") ?? "",
    10,
  );
  if (!Number.isFinite(agentDbId) || agentDbId <= 0) {
    return NextResponse.json({ error: "agentDbId is required" }, { status: 400 });
  }

  const access = await assertMetaplexLaunchAttemptAccess(session, agentDbId);
  if (!access.ok) {
    return NextResponse.json({ error: "Not authorized" }, { status: access.status });
  }

  const attempt = await loadMetaplexLaunchAttemptForAgent(agentDbId);
  return NextResponse.json({
    attempt: attempt ? serializeMetaplexLaunchAttempt(attempt) : null,
  });
}
