import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listAgentMcpBindings } from "@/features/agent-chat/server/mcp/binding-repository";
import { assertDashboardMcpAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import {
  toDashboardMcpBinding,
  toDashboardMcpConnection,
} from "@/features/agent-chat/server/mcp/dashboard-dto";
import {
  mcpApiError,
  parsePositiveAgentId,
} from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  try {
    const agentDbId = parsePositiveAgentId((await params).agentDbId);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccess(session, agentDbId);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    const items = await listAgentMcpBindings({
      appAccountId: access.appAccountId,
      agentDbId,
    });
    return NextResponse.json({
      items: items.map((item) => ({
        connection: {
          ...toDashboardMcpConnection(item.connection),
          attachedAgentCount: item.attachedAgentCount,
        },
        binding: toDashboardMcpBinding(item.binding),
        canEnable: item.canEnable,
        enableBlockedReason: item.enableBlockedReason,
        enableBlockedCode: item.enableBlockedCode,
        enabledToolCount: item.enabledToolCount,
        highestEnabledRisk: item.highestEnabledRisk,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mcpApiError(error, "Could not load agent MCP connections");
  }
}
