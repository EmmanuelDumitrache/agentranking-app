import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { writeMcpAudit } from "@/features/agent-chat/server/mcp/audit";
import {
  listBindingMcpTools,
  patchBindingMcpToolPolicy,
} from "@/features/agent-chat/server/mcp/binding-repository";
import { assertDashboardMcpAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { toDashboardMcpTool } from "@/features/agent-chat/server/mcp/dashboard-dto";
import { McpRuntimeError } from "@/features/agent-chat/server/mcp/errors";
import { enforceMcpMutationRateLimit } from "@/features/agent-chat/server/mcp/reliability";
import {
  mcpApiError,
  parsePositiveAgentId,
} from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  approvalMode: z.enum([
    "AUTO_READ_ONLY",
    "CONFIRM_MUTATIONS",
    "CONFIRM_EVERY_CALL",
    "BLOCK_ALL",
  ]).nullable().optional(),
  maxCallsPerRun: z.number().int().min(1).max(50).nullable().optional(),
  inputConstraint: z.record(z.string(), z.unknown()).nullable().optional(),
  acknowledgeSchemaHash: z.string().regex(/^[a-f0-9]{64}$/iu).nullable().optional(),
  reset: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  const supplied = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (supplied.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one MCP tool policy change is required",
    });
  }
  if (value.reset && supplied.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reset"],
      message: "Reset cannot be combined with other MCP tool policy changes",
    });
  }
});

export async function PATCH(
  request: NextRequest,
  { params }: {
    params: Promise<{ agentDbId: string; connectionId: string; toolId: string }>;
  },
) {
  try {
    assertSameOriginMutation(request);
    const route = await params;
    const agentDbId = parsePositiveAgentId(route.agentDbId);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccess(session, agentDbId);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    await enforceMcpMutationRateLimit({ appAccountId: access.appAccountId, operation: "binding" });
    const patch = patchSchema.parse(await request.json());
    await patchBindingMcpToolPolicy({
      appAccountId: access.appAccountId,
      agentDbId,
      connectionId: route.connectionId,
      toolId: route.toolId,
      patch,
    });
    const current = await listBindingMcpTools({
      appAccountId: access.appAccountId,
      agentDbId,
      connectionId: route.connectionId,
    });
    const item = current.tools.find((candidate) => candidate.descriptor.id === route.toolId);
    if (!item) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP tool was not found");
    await writeMcpAudit({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      agentDbId,
      bindingId: current.binding.id,
      connectionId: route.connectionId,
      toolId: route.toolId,
      action: patch.reset ? "TOOL_POLICY_RESET" : "TOOL_POLICY_UPDATE",
      status: "SUCCEEDED",
      metadata: {
        enabled: patch.enabled,
        approvalMode: patch.approvalMode,
        acknowledgedSchemaHash: patch.acknowledgeSchemaHash,
      },
    });
    return NextResponse.json({
      tool: toDashboardMcpTool({
        ...item,
        binding: current.binding,
      }),
    });
  } catch (error) {
    return mcpApiError(error, "Could not update MCP tool policy");
  }
}
