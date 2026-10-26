import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { writeMcpAudit } from "@/features/agent-chat/server/mcp/audit";
import {
  listAgentMcpBindings,
  removeAgentMcpBinding,
  upsertAgentMcpBinding,
} from "@/features/agent-chat/server/mcp/binding-repository";
import { assertDashboardMcpAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import {
  toDashboardMcpBinding,
  toDashboardMcpConnection,
} from "@/features/agent-chat/server/mcp/dashboard-dto";
import { McpRuntimeError } from "@/features/agent-chat/server/mcp/errors";
import { enforceMcpMutationRateLimit } from "@/features/agent-chat/server/mcp/reliability";
import {
  mcpApiError,
  parsePositiveAgentId,
} from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  enabled: z.boolean(),
  approvalMode: z.enum([
    "AUTO_READ_ONLY",
    "CONFIRM_MUTATIONS",
    "CONFIRM_EVERY_CALL",
    "BLOCK_ALL",
  ]).optional(),
  maxCallsPerRun: z.number().int().min(1).max(50).optional(),
  maxParallelCalls: z.number().int().min(1).max(4).optional(),
  callTimeoutMs: z.number().int().min(1_000).max(60_000).optional(),
  outputByteLimit: z.number().int().min(16_384).max(1_048_576).optional(),
  expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; connectionId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    const route = await params;
    const agentDbId = parsePositiveAgentId(route.agentDbId);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccess(session, agentDbId);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    await enforceMcpMutationRateLimit({ appAccountId: access.appAccountId, operation: "binding" });
    const input = putSchema.parse(await request.json());
    const binding = await upsertAgentMcpBinding({
      appAccountId: access.appAccountId,
      agentDbId,
      connectionId: route.connectionId,
      ...input,
    });
    const items = await listAgentMcpBindings({
      appAccountId: access.appAccountId,
      agentDbId,
    });
    const item = items.find((candidate) => candidate.connection.id === route.connectionId);
    if (!item) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was not found");
    await writeMcpAudit({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      agentDbId,
      bindingId: binding.id,
      connectionId: route.connectionId,
      action: input.enabled ? "BINDING_ENABLE" : "BINDING_DISABLE",
      status: "SUCCEEDED",
      metadata: {
        approvalMode: binding.approvalMode,
        maxCallsPerRun: binding.maxCallsPerRun,
        maxParallelCalls: binding.maxParallelCalls,
      },
    });
    return NextResponse.json({
      item: {
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
      },
    });
  } catch (error) {
    return mcpApiError(error, "Could not update agent MCP connection");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; connectionId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    const route = await params;
    const agentDbId = parsePositiveAgentId(route.agentDbId);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccess(session, agentDbId);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    await enforceMcpMutationRateLimit({ appAccountId: access.appAccountId, operation: "binding" });
    const removed = await removeAgentMcpBinding({
      appAccountId: access.appAccountId,
      agentDbId,
      connectionId: route.connectionId,
    });
    await writeMcpAudit({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      agentDbId,
      connectionId: removed ? route.connectionId : undefined,
      action: "BINDING_REMOVE",
      status: "SUCCEEDED",
      metadata: { removed },
    });
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    return mcpApiError(error, "Could not remove agent MCP connection");
  }
}
