import "server-only";

import { fromJsonSchema } from "@modelcontextprotocol/client";
import { prisma } from "@/lib/db";
import { connectionCanBeEnabled } from "./binding-repository";
import { McpRuntimeError } from "./errors";
import { getMcpProviderManifest, providerAllowsExistingConnection } from "./provider-registry";
import {
  hydrateCatalog,
  isCatalogFresh,
  isCatalogReusableForConnection,
  isCatalogWithinMaximumStaleAge,
} from "./repository";
import { GENERIC_MCP_HARD_BLOCK_RISKS } from "./risk";
import {
  assertMcpConnectionRuntimeAllowed,
  assertMcpToolPlatformAllowed,
} from "./platform-policy";
import type {
  McpApprovalMode,
  McpBindingRecord,
  McpConnectionRecord,
  McpToolDescriptorRecord,
  McpToolPolicyRecord,
} from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mcpExecutionHasApprovedToolCall(options: unknown): boolean {
  if (!isObject(options) || typeof options.toolCallId !== "string" || !Array.isArray(options.messages)) {
    return false;
  }
  const approvalIds = new Set<string>();
  for (const message of options.messages) {
    if (!isObject(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        isObject(part)
        && part.type === "tool-approval-request"
        && part.toolCallId === options.toolCallId
        && typeof part.approvalId === "string"
      ) approvalIds.add(part.approvalId);
    }
  }
  const lastMessage = options.messages.at(-1);
  if (!isObject(lastMessage) || lastMessage.role !== "tool" || !Array.isArray(lastMessage.content)) {
    return false;
  }
  return lastMessage.content.some((part) => isObject(part)
    && part.type === "tool-approval-response"
    && part.approved === true
    && typeof part.approvalId === "string"
    && approvalIds.has(part.approvalId));
}

export async function assertMcpToolInput(schema: unknown, input: unknown): Promise<void> {
  if (!isObject(schema)) {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Stored MCP tool input schema is invalid");
  }
  try {
    const validator = fromJsonSchema<unknown>(schema);
    const outcome = await validator["~standard"].validate(input);
    if ("issues" in outcome && outcome.issues && outcome.issues.length > 0) {
      throw new McpRuntimeError("MCP_POLICY_BLOCKED", "MCP tool input does not satisfy the authorized schema");
    }
  } catch (error) {
    if (error instanceof McpRuntimeError) throw error;
    throw new McpRuntimeError(
      "MCP_POLICY_BLOCKED",
      "Stored MCP tool input schema could not be validated",
      { cause: error },
    );
  }
}

export async function assertMcpToolOutput(schema: unknown, result: unknown): Promise<void> {
  if (schema === null || schema === undefined) return;
  if (isObject(result) && result.isError === true) return;
  if (!isObject(schema)) {
    throw new McpRuntimeError("MCP_PROTOCOL_UNSUPPORTED", "Stored MCP tool output schema is invalid");
  }
  const structuredContent = isObject(result) ? result.structuredContent : undefined;
  if (structuredContent === undefined) {
    throw new McpRuntimeError(
      "MCP_PROTOCOL_UNSUPPORTED",
      "MCP tool omitted structured content required by its output schema",
    );
  }
  try {
    const validator = fromJsonSchema<unknown>(schema);
    const outcome = await validator["~standard"].validate(structuredContent);
    if ("issues" in outcome && outcome.issues && outcome.issues.length > 0) {
      throw new McpRuntimeError(
        "MCP_PROTOCOL_UNSUPPORTED",
        "MCP tool output does not satisfy its advertised schema",
      );
    }
  } catch (error) {
    if (error instanceof McpRuntimeError) throw error;
    throw new McpRuntimeError(
      "MCP_PROTOCOL_UNSUPPORTED",
      "Stored MCP tool output schema could not be validated",
      { cause: error },
    );
  }
}

export type AuthorizedMcpInvocation = {
  binding: McpBindingRecord;
  connection: McpConnectionRecord;
  descriptor: McpToolDescriptorRecord;
  policy: McpToolPolicyRecord | null;
  approvalMode: McpApprovalMode;
  maxCallsPerTool: number;
};

export async function authorizeMcpBindingAccess(params: {
  appAccountId: string;
  agentDbId: number;
  bindingId: string;
  connectionId: string;
}): Promise<{ binding: McpBindingRecord; connection: McpConnectionRecord }> {
  const binding = await prisma.agentMcpBinding.findFirst({
    where: {
      id: params.bindingId,
      appAccountId: params.appAccountId,
      agentDbId: params.agentDbId,
      connectionId: params.connectionId,
      enabled: true,
    },
    include: { connection: { include: { credential: true, catalog: true } } },
  });
  if (!binding || binding.approvalMode === "BLOCK_ALL") {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "MCP connection is not enabled for this agent");
  }
  const connection = binding.connection as unknown as McpConnectionRecord;
  await assertMcpConnectionRuntimeAllowed(connection);
  const eligibility = connectionCanBeEnabled(connection);
  if (!eligibility.ok) throw new McpRuntimeError(eligibility.code, eligibility.reason);
  const catalog = hydrateCatalog(connection.catalog);
  if (!isCatalogReusableForConnection(catalog, connection) || !isCatalogWithinMaximumStaleAge(catalog)) {
    throw new McpRuntimeError("MCP_CATALOG_STALE", "MCP catalog must be refreshed");
  }
  return { binding: binding as unknown as McpBindingRecord, connection };
}

export async function authorizeMcpInvocation(params: {
  appAccountId: string;
  agentDbId: number;
  bindingId: string;
  connectionId: string;
  descriptorId: string;
  expectedSchemaHash: string;
  input: unknown;
}): Promise<AuthorizedMcpInvocation> {
  const binding = await prisma.agentMcpBinding.findFirst({
    where: {
      id: params.bindingId,
      appAccountId: params.appAccountId,
      agentDbId: params.agentDbId,
      connectionId: params.connectionId,
      enabled: true,
    },
    include: {
      connection: {
        include: { credential: true, catalog: true },
      },
      toolPolicies: {
        where: { toolId: params.descriptorId },
      },
    },
  });
  if (!binding) throw new McpRuntimeError("MCP_POLICY_BLOCKED", "This agent is no longer assigned to the MCP connection");
  const connection = binding.connection as unknown as McpConnectionRecord;
  await assertMcpConnectionRuntimeAllowed(connection);
  const eligible = connectionCanBeEnabled(connection);
  if (!eligible.ok) throw new McpRuntimeError(eligible.code, eligible.reason);
  const manifest = getMcpProviderManifest(connection.providerKey);
  if (!providerAllowsExistingConnection(manifest, connection.providerKey)) {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Provider is blocked by platform policy");
  }
  const catalog = hydrateCatalog(connection.catalog);
  if (
    !isCatalogReusableForConnection(catalog, connection)
    || !isCatalogWithinMaximumStaleAge(catalog)
  ) {
    throw new McpRuntimeError("MCP_CATALOG_STALE", "MCP catalog must be refreshed before this tool can run");
  }
  const descriptor = await prisma.agentMcpToolDescriptor.findFirst({
    where: {
      id: params.descriptorId,
      connectionId: params.connectionId,
      active: true,
    },
  });
  if (!descriptor) throw new McpRuntimeError("MCP_CATALOG_CHANGED", "MCP tool is no longer in the active catalog");
  await assertMcpToolPlatformAllowed({
    connection,
    toolName: descriptor.name,
    risk: descriptor.effectiveRisk,
  });
  if (descriptor.schemaHash !== params.expectedSchemaHash) {
    throw new McpRuntimeError("MCP_CATALOG_CHANGED", "MCP tool schema changed before invocation");
  }
  if (
    !["READ_ONLY", "ANALYTICS_QUERY"].includes(descriptor.effectiveRisk)
    && !isCatalogFresh(catalog, connection)
  ) {
    throw new McpRuntimeError(
      "MCP_CATALOG_STALE",
      "State-changing MCP tools require a fresh catalog",
    );
  }
  const policy = binding.toolPolicies[0] ?? null;
  if (descriptor.quarantined && policy?.acknowledgedSchemaHash !== descriptor.schemaHash) {
    throw new McpRuntimeError("MCP_TOOL_QUARANTINED", "MCP tool is quarantined pending review");
  }
  if (GENERIC_MCP_HARD_BLOCK_RISKS.has(descriptor.effectiveRisk)) {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "This risk class is blocked in the generic MCP execution path");
  }
  if (policy?.enabled === false) throw new McpRuntimeError("MCP_POLICY_BLOCKED", "MCP tool is disabled for this agent");
  if (
    policy?.acknowledgedSchemaHash
    && policy.acknowledgedSchemaHash !== descriptor.schemaHash
  ) {
    throw new McpRuntimeError("MCP_CATALOG_CHANGED", "MCP tool policy has not acknowledged the current schema");
  }
  await assertMcpToolInput(descriptor.inputSchema, params.input);
  if (policy?.inputConstraint) await assertMcpToolInput(policy.inputConstraint, params.input);
  if (binding.approvalMode === "BLOCK_ALL" || policy?.approvalMode === "BLOCK_ALL") {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "This agent policy blocks all calls to the tool");
  }
  return {
    binding: binding as unknown as McpBindingRecord,
    connection,
    descriptor: descriptor as unknown as McpToolDescriptorRecord,
    policy: policy as unknown as McpToolPolicyRecord | null,
    approvalMode: policy?.approvalMode ?? binding.approvalMode,
    maxCallsPerTool: policy?.maxCallsPerRun ?? binding.maxCallsPerRun,
  };
}
