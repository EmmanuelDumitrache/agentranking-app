import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { forceAdminMcpConnectionAction } from "@/lib/admin/operations/mcp-policies.server";
import { mcpApiError } from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

const actionSchema = z.object({ action: z.enum(["refresh", "reauth"]) }).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    const { connectionId } = await params;
    const input = actionSchema.parse(await request.json());
    const connection = await forceAdminMcpConnectionAction({ connectionId, action: input.action });
    return NextResponse.json({ connection });
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return mcpApiError(error, "Could not run MCP administrator action");
  }
}
