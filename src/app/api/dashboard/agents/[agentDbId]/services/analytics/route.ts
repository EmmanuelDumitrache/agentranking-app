import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadDashboardServiceUsage } from "@/lib/dashboard/service-workspace.server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const agentDbId = Number.parseInt((await params).agentDbId, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const usage = await loadDashboardServiceUsage(agentDbId);
  if (!usage) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(usage);
}
