import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadAgentTerminalActivityLog } from "@/lib/agent-trading/terminal-log.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await context.params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }

  const lines = await loadAgentTerminalActivityLog(access.agent.id);
  return NextResponse.json({ lines });
}
