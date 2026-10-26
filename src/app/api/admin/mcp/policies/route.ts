import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import {
  createAdminMcpRule,
  readAdminMcpOperations,
} from "@/lib/admin/operations/mcp-policies.server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import {
  MCP_ADMIN_RULE_ACTIONS,
  MCP_ADMIN_RULE_SCOPES,
} from "@/features/agent-chat/server/mcp/platform-policy";
import { mcpApiError } from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  scope: z.enum(MCP_ADMIN_RULE_SCOPES),
  value: z.string().min(1).max(512),
  action: z.enum(MCP_ADMIN_RULE_ACTIONS),
  note: z.string().max(2_000).optional(),
}).strict();

export async function GET() {
  try {
    const { rules } = await readAdminMcpOperations();
    return NextResponse.json({ rules }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return mcpApiError(error, "Could not load MCP administrator policies");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const input = createSchema.parse(await request.json());
    const rule = await createAdminMcpRule(input);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return mcpApiError(error, "Could not create MCP administrator policy");
  }
}
