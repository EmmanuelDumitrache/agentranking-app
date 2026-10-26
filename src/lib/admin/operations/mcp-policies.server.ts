import "server-only";

import { prisma } from "@/lib/db";
import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";
import { writeMcpAudit } from "@/features/agent-chat/server/mcp/audit";
import { forceMcpConnectionReauthentication } from "@/features/agent-chat/server/mcp/credentials";
import { verifyAndDiscoverMcpConnection } from "@/features/agent-chat/server/mcp/discovery-service";
import { McpRuntimeError, mcpErrorCode } from "@/features/agent-chat/server/mcp/errors";
import {
  normalizeMcpAdminRuleValue,
  type McpAdminRuleAction,
  type McpAdminRuleScope,
} from "@/features/agent-chat/server/mcp/platform-policy";
import { getMcpConnection } from "@/features/agent-chat/server/mcp/repository";
import { requireAdminOperationsSession } from "./auth.server";

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

export async function readAdminMcpOperations() {
  await requireAdminOperationsSession();
  const [rules, connections, invocations] = await Promise.all([
    prisma.agentMcpAdminRule.findMany({
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    }),
    prisma.agentMcpConnection.findMany({
      where: { deletedAt: null },
      orderBy: [{ lastErrorAt: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        appAccountId: true,
        providerKey: true,
        displayName: true,
        endpointOrigin: true,
        authMode: true,
        transportMode: true,
        status: true,
        disabledAt: true,
        statusReasonCode: true,
        statusMessage: true,
        serverName: true,
        serverVersion: true,
        protocolVersion: true,
        catalogRevision: true,
        lastVerifiedAt: true,
        lastDiscoveredAt: true,
        lastHealthyAt: true,
        lastErrorAt: true,
        lastErrorCode: true,
        consecutiveFailures: true,
        circuitOpenUntil: true,
        updatedAt: true,
        appAccount: {
          select: { displayName: true, email: true },
        },
        bindings: {
          select: {
            id: true,
            enabled: true,
            agent: { select: { id: true, name: true, chainId: true, agentId: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        auditLogs: {
          select: {
            id: true,
            action: true,
            status: true,
            reasonCode: true,
            metadataJson: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 12,
        },
      },
    }),
    prisma.agentChatToolEvent.findMany({
      where: { sourceConnectionId: { not: null } },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: {
        id: true,
        sourceConnectionId: true,
        sourceBindingId: true,
        sourceToolName: true,
        sourceDisplayName: true,
        effectiveRisk: true,
        approvalDecision: true,
        requestBytes: true,
        responseBytes: true,
        retryCount: true,
        sanitizedTargetJson: true,
        state: true,
        durationMs: true,
        startedAt: true,
        completedAt: true,
      },
    }),
  ]);

  return {
    rules: rules.map((rule) => ({
      ...rule,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    })),
    connections: connections.map((connection) => ({
      id: connection.id,
      appAccountId: connection.appAccountId,
      accountLabel: connection.appAccount.displayName || connection.appAccount.email || connection.appAccountId,
      providerKey: connection.providerKey,
      displayName: connection.displayName,
      endpointOrigin: connection.endpointOrigin,
      authMode: connection.authMode,
      transportMode: connection.transportMode,
      status: connection.status,
      disabledAt: iso(connection.disabledAt),
      statusReasonCode: connection.statusReasonCode,
      statusMessage: connection.statusMessage,
      serverName: connection.serverName,
      serverVersion: connection.serverVersion,
      protocolVersion: connection.protocolVersion,
      catalogRevision: connection.catalogRevision,
      lastVerifiedAt: iso(connection.lastVerifiedAt),
      lastDiscoveredAt: iso(connection.lastDiscoveredAt),
      lastHealthyAt: iso(connection.lastHealthyAt),
      lastErrorAt: iso(connection.lastErrorAt),
      lastErrorCode: connection.lastErrorCode,
      consecutiveFailures: connection.consecutiveFailures,
      circuitOpenUntil: iso(connection.circuitOpenUntil),
      updatedAt: connection.updatedAt.toISOString(),
      agents: connection.bindings.map((binding) => ({
        bindingId: binding.id,
        enabled: binding.enabled,
        ...binding.agent,
      })),
      audit: connection.auditLogs.map((event) => ({
        ...event,
        metadataJson: redactSensitiveData(event.metadataJson),
        createdAt: event.createdAt.toISOString(),
      })),
    })),
    invocations: invocations.map((event) => ({
      ...event,
      sanitizedTargetJson: redactSensitiveData(event.sanitizedTargetJson),
      startedAt: event.startedAt.toISOString(),
      completedAt: iso(event.completedAt),
    })),
  };
}

export async function createAdminMcpRule(params: {
  scope: McpAdminRuleScope;
  value: string;
  action: McpAdminRuleAction;
  note?: string;
}) {
  const session = await requireAdminOperationsSession();
  if (
    ["CONNECTION_ID", "TOOL_PATTERN", "RISK_CLASS"].includes(params.scope)
    && params.action === "BLOCK_NEW"
  ) {
    throw new McpRuntimeError(
      "MCP_POLICY_BLOCKED",
      "Connection ID, tool, and risk rules cannot govern creation before a connection exists",
    );
  }
  const value = normalizeMcpAdminRuleValue(params.scope, params.value);
  return await prisma.agentMcpAdminRule.upsert({
    where: {
      scope_value_action: { scope: params.scope, value, action: params.action },
    },
    create: {
      scope: params.scope,
      value,
      action: params.action,
      active: true,
      note: params.note?.trim().slice(0, 2_000) ?? "",
      createdBy: session.username.slice(0, 160),
      updatedBy: session.username.slice(0, 160),
    },
    update: {
      active: true,
      note: params.note?.trim().slice(0, 2_000) ?? "",
      updatedBy: session.username.slice(0, 160),
    },
  });
}

export async function patchAdminMcpRule(params: {
  id: string;
  active?: boolean;
  note?: string;
}) {
  const session = await requireAdminOperationsSession();
  const existing = await prisma.agentMcpAdminRule.findUnique({ where: { id: params.id } });
  if (!existing) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP administrator rule was not found");
  return await prisma.agentMcpAdminRule.update({
    where: { id: params.id },
    data: {
      active: params.active,
      note: params.note === undefined ? undefined : params.note.trim().slice(0, 2_000),
      updatedBy: session.username.slice(0, 160),
    },
  });
}

export async function forceAdminMcpConnectionAction(params: {
  connectionId: string;
  action: "refresh" | "reauth";
}) {
  const session = await requireAdminOperationsSession();
  const row = await prisma.agentMcpConnection.findUnique({
    where: { id: params.connectionId },
    select: { appAccountId: true },
  });
  if (!row) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was not found");
  let connection = await getMcpConnection({
    appAccountId: row.appAccountId,
    connectionId: params.connectionId,
  });
  if (!connection) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was not found");

  const auditAction = params.action === "refresh" ? "ADMIN_FORCE_REFRESH" : "ADMIN_FORCE_REAUTH";
  let oauthRevocation: string | undefined;
  try {
    if (params.action === "refresh") {
      await verifyAndDiscoverMcpConnection({
        appAccountId: connection.appAccountId,
        connectionId: connection.id,
        operation: "discover",
        administrativeOverride: true,
      });
    } else {
      const result = await forceMcpConnectionReauthentication(connection);
      oauthRevocation = result.oauthRevocation;
    }
    await writeMcpAudit({
      appAccountId: connection.appAccountId,
      connectionId: connection.id,
      action: auditAction,
      status: "SUCCEEDED",
      metadata: {
        administrator: session.username.slice(0, 160),
        ...(oauthRevocation ? { oauthRevocation } : {}),
      },
    });
  } catch (error) {
    await writeMcpAudit({
      appAccountId: connection.appAccountId,
      connectionId: connection.id,
      action: auditAction,
      status: "FAILED",
      reasonCode: mcpErrorCode(error),
      metadata: { administrator: session.username.slice(0, 160) },
    }).catch(() => undefined);
    throw error;
  }
  connection = await getMcpConnection({
    appAccountId: connection.appAccountId,
    connectionId: connection.id,
  });
  if (!connection) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was not found");
  return {
    id: connection.id,
    status: connection.status,
    statusReasonCode: connection.statusReasonCode,
    statusMessage: connection.statusMessage,
    catalogRevision: connection.catalogRevision,
    lastDiscoveredAt: iso(connection.lastDiscoveredAt),
    lastHealthyAt: iso(connection.lastHealthyAt),
  };
}
