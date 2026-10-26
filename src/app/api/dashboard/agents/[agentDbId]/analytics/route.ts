import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { loadDashboardAgentAnalyticsDto } from "@/lib/dashboard/analytics-snapshot.server";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ agentDbId: string }> };
export async function GET(_request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getDashboardAccess(session);
  if (!access.ownedAgents.some((agent) => agent.id === id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const snapshot = await loadDashboardAgentAnalyticsDto(id);
  if (!snapshot) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  return NextResponse.json({ snapshot });
}
