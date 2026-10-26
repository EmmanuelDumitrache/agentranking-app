import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { assertDashboardMcpAccountAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { toDashboardMcpConnection } from "@/features/agent-chat/server/mcp/dashboard-dto";
import { verifyAndDiscoverMcpConnection } from "@/features/agent-chat/server/mcp/discovery-service";
import { enforceMcpMutationRateLimit } from "@/features/agent-chat/server/mcp/reliability";
import { getMcpConnection } from "@/features/agent-chat/server/mcp/repository";
import { mcpApiError } from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccountAccess(session);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    await enforceMcpMutationRateLimit({ appAccountId: access.appAccountId, operation: "verify" });
    const connectionId = (await params).connectionId;
    const result = await verifyAndDiscoverMcpConnection({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      connectionId,
      operation: "verify",
      signal: request.signal,
    });
    const connection = await getMcpConnection({
      appAccountId: access.appAccountId,
      connectionId,
    });
    return NextResponse.json({
      ok: true,
      changes: result.changes,
      connection: connection ? toDashboardMcpConnection(connection) : null,
    });
  } catch (error) {
    return mcpApiError(error, "MCP verification failed");
  }
}
