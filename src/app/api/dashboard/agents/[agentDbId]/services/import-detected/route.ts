import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardMcpAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import { importDiscoveredAgentServices } from "@/lib/dashboard/service-discovery";
export const dynamic = "force-dynamic";
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardMcpAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const result = await importDiscoveredAgentServices(agentDbId);
  if (result.importedServices > 0 || result.importedMetadataKeys.length > 0) {
    await revalidateAgentByDbId(agentDbId);
  }
  return NextResponse.json(result);
}
