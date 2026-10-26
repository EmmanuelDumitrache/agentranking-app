import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { listAgentScheduleRuns } from "@/lib/agent-schedule/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ agentDbId: string; scheduleId: string }>;
};

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { agentDbId, scheduleId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const runs = await listAgentScheduleRuns(scheduleId);
  return NextResponse.json({ runs });
}
