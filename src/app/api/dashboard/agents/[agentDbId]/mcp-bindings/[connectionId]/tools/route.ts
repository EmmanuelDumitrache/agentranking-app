import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBindingMcpTools } from "@/features/agent-chat/server/mcp/binding-repository";
import { assertDashboardMcpAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import {
  toDashboardMcpBinding,
  toDashboardMcpTool,
} from "@/features/agent-chat/server/mcp/dashboard-dto";
import {
  mcpApiError,
  parsePositiveAgentId,
} from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; connectionId: string }> },
) {
  try {
    const route = await params;
    const agentDbId = parsePositiveAgentId(route.agentDbId);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccess(session, agentDbId);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    const result = await listBindingMcpTools({
      appAccountId: access.appAccountId,
      agentDbId,
      connectionId: route.connectionId,
    });
    return NextResponse.json({
      binding: toDashboardMcpBinding(result.binding),
      tools: result.tools.map((item) => toDashboardMcpTool({
        ...item,
        binding: result.binding,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mcpApiError(error, "Could not load MCP tool policies");
  }
}
