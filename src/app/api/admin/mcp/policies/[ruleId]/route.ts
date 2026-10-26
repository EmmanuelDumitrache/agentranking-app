import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { patchAdminMcpRule } from "@/lib/admin/operations/mcp-policies.server";
import { mcpApiError } from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  active: z.boolean().optional(),
  note: z.string().max(2_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "No changes supplied");

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    const { ruleId } = await params;
    const input = patchSchema.parse(await request.json());
    const rule = await patchAdminMcpRule({ id: ruleId, ...input });
    return NextResponse.json({ rule });
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return mcpApiError(error, "Could not update MCP administrator policy");
  }
}
