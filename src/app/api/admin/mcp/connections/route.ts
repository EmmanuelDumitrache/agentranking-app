import { NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminMcpOperations } from "@/lib/admin/operations/mcp-policies.server";
import { mcpApiError } from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { connections, invocations } = await readAdminMcpOperations();
    return NextResponse.json({ connections, invocations }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return mcpApiError(error, "Could not load MCP connection health");
  }
}
