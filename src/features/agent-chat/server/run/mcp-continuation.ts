import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type {
  AgentChatAccess,
  McpContinuationResponse,
} from "../../shared/contracts";
import {
  claimMcpContinuation,
  persistInputRequiredResult,
} from "../mcp/continuations";
import { writeMcpAudit } from "../mcp/audit";
import { mcpToolSchemaHash } from "../mcp/catalog-validation";
import { connectMcpClient } from "../mcp/client-factory";
import {
  applyMcpToolArgumentCredential,
  redactMcpCredentialEcho,
} from "../mcp/credentials";
import {
  McpRuntimeError,
  isMcpCancellation,
  mcpConnectionStatusForError,
  mcpErrorCode,
  safeMcpErrorDetails,
} from "../mcp/errors";
import { withMcpInvocationConcurrency } from "../mcp/invocation-guard";
import {
  recordMcpToolBytes,
  withObservedMcpOperation,
} from "../mcp/observability";
import { getMcpConnection, updateMcpConnectionStatus } from "../mcp/repository";
import { getMcpProviderManifest } from "../mcp/provider-registry";
import {
  assertMcpToolOutput,
  authorizeMcpBindingAccess,
  authorizeMcpInvocation,
} from "../mcp/policy-service";
import { mcpRiskRequiresApproval } from "../mcp/risk";
import {
  assertMcpCircuitAvailable,
  enforceMcpInvocationLimits,
  recordMcpCircuitFailure,
  recordMcpCircuitSuccess,
} from "../mcp/reliability";
import {
  boundExternalJson,
  DEFAULT_MCP_MODEL_BOUNDS,
  normalizeMcpMetaResultForExecution,
  normalizeMcpToolResultForExecution,
} from "../mcp/result-normalizer";
import type { McpConnectionRecord, McpToolDefinition } from "../mcp/types";
import { enforceNativeTransactionBoundary } from "../mcp/transaction-boundary";
import {
  extractTextContent,
  validateAgentChatUIMessages,
  type AgentChatUIMessage,
  type AgentChatUIPart,
} from "../../shared/ui-message";
import { validatePersistedAgentChatMessage } from "../persisted-ui-message";
import { projectMessageSearchFields } from "../message-search-projection";
import { resolveAgentChatInitiatingTurn } from "./turn-lineage";
import { HttpError } from "../http-error";

const MAX_PART_SCAN_NODES = 10_000;

type CanonicalContinuationMessage = {
  id: string;
  parts: AgentChatUIPart[];
  triggerMessageId: string;
  parentRunId: string;
  initiatingUserText: string;
  initiatingUserParts: AgentChatUIMessage["parts"];
};

export type AppliedMcpContinuation = CanonicalContinuationMessage & {
  conversationId: string;
  continuationRequestId: string;
  status: "resumed" | "input_required" | "blocked";
  result: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function inputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function containsContinuationId(
  value: unknown,
  continuationId: string,
  budget: { nodes: number },
): boolean {
  if (budget.nodes <= 0) return false;
  budget.nodes -= 1;
  if (Array.isArray(value)) {
    return value.some((entry) =>
      containsContinuationId(entry, continuationId, budget),
    );
  }
  const record = asRecord(value);
  if (!record) return false;
  if (record.continuationId === continuationId) return true;
  return Object.values(record).some((entry) =>
    containsContinuationId(entry, continuationId, budget),
  );
}

function replaceContinuationResult(
  value: unknown,
  continuationId: string,
  replacement: unknown,
  budget: { nodes: number },
): { value: unknown; replaced: boolean } {
  if (budget.nodes <= 0) return { value, replaced: false };
  budget.nodes -= 1;
  if (Array.isArray(value)) {
    let replaced = false;
    const next = value.map((entry) => {
      if (replaced) return entry;
      const candidate = replaceContinuationResult(
        entry,
        continuationId,
        replacement,
        budget,
      );
      if (candidate.replaced) replaced = true;
      return candidate.value;
    });
    return { value: replaced ? next : value, replaced };
  }
  const record = asRecord(value);
  if (!record) return { value, replaced: false };
  if (record.continuationId === continuationId) {
    return { value: replacement, replaced: true };
  }
  for (const [key, entry] of Object.entries(record)) {
    const candidate = replaceContinuationResult(
      entry,
      continuationId,
      replacement,
      budget,
    );
    if (!candidate.replaced) continue;
    return {
      value: { ...record, [key]: candidate.value },
      replaced: true,
    };
  }
  return { value, replaced: false };
}

async function findCanonicalContinuationMessage(params: {
  access: AgentChatAccess;
  conversationId: string;
  continuationId: string;
}): Promise<CanonicalContinuationMessage> {
  const batchSize = 50;
  let beforeSequence: number | undefined;

  for (;;) {
    const messages = await prisma.agentChatMessage.findMany({
      where: {
        conversationId: params.conversationId,
        role: "assistant",
        ...(beforeSequence === undefined
          ? {}
          : { sequence: { lt: beforeSequence } }),
        conversation: {
          appAccountId: params.access.appAccountId,
          agentDbId: params.access.agentDbId,
          status: "ACTIVE",
        },
      },
      orderBy: { sequence: "desc" },
      take: batchSize,
      select: {
        id: true,
        sequence: true,
        role: true,
        parts: true,
        metadata: true,
        responseRun: { select: { id: true } },
      },
    });

    for (const message of messages) {
      if (
        !containsContinuationId(message.parts, params.continuationId, {
          nodes: MAX_PART_SCAN_NODES,
        })
      ) {
        continue;
      }

      if (!message.responseRun?.id) {
        throw new HttpError(
          500,
          "INTERNAL",
          "The persisted MCP continuation message has no producing run",
        );
      }
      const initiating = await resolveAgentChatInitiatingTurn(prisma, {
        runId: message.responseRun.id,
        conversationId: params.conversationId,
      });
      if (!initiating) {
        throw new HttpError(
          500,
          "INTERNAL",
          "The MCP continuation run lineage has no canonical initiating turn",
        );
      }

      const assistant = await validatePersistedAgentChatMessage(message);
      const user = await validatePersistedAgentChatMessage(initiating.message);

      return {
        id: message.id,
        parts: assistant.parts,
        triggerMessageId: message.id,
        parentRunId: message.responseRun.id,
        initiatingUserText: extractTextContent(user),
        initiatingUserParts: user.parts,
      };
    }

    if (messages.length < batchSize) break;
    const oldest = messages[messages.length - 1];
    if (!oldest) break;
    beforeSequence = oldest.sequence;
  }

  throw new HttpError(
    404,
    "INVALID_MESSAGE",
    "The MCP continuation is not associated with this conversation",
  );
}

function continuationRequestId(params: {
  appAccountId: string;
  agentDbId: number;
  conversationId: string;
  continuationId: string;
  responses: readonly McpContinuationResponse[];
}): string {
  const responses = [...params.responses]
    .sort((a, b) => a.requestKey.localeCompare(b.requestKey))
    .map((response) => ({
      requestKey: response.requestKey,
      action: response.action,
      content: response.content ?? null,
    }));
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        account: params.appAccountId,
        agent: params.agentDbId,
        conversation: params.conversationId,
        continuation: params.continuationId,
        responses,
      }),
    )
    .digest("hex");
  return `mcp-continuation:${digest}`;
}

function retryParams(params: {
  original: Record<string, unknown>;
  requestState?: string;
  inputResponses: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...params.original,
    ...(params.requestState === undefined
      ? {}
      : { requestState: params.requestState }),
    inputResponses: params.inputResponses,
  };
}

async function invokeContinuation(params: {
  connection: McpConnectionRecord;
  method: "tools/call" | "resources/read" | "prompts/get";
  request: Record<string, unknown>;
  toolDefinition?: McpToolDefinition;
  signal?: AbortSignal;
}): Promise<unknown> {
  const connected = await connectMcpClient({
    connection: params.connection,
    signal: params.signal,
  });
  try {
    await updateMcpConnectionStatus({
      connectionId: params.connection.id,
      status: "READY",
      expectedVersion: params.connection.version,
      expectedStatuses: [params.connection.status],
    }).catch((statusError) => {
      console.warn("[agent-chat] failed to persist MCP continuation readiness", {
        connectionId: params.connection.id,
        error: safeMcpErrorDetails(statusError),
      });
    });
    if (params.method === "tools/call") {
      const manifest = getMcpProviderManifest(params.connection.providerKey);
      const toolArgumentAuth = (manifest?.authOptions
        ?? (manifest ? [manifest.auth] : []))
        .find((auth) => auth.kind === "api-key-tool-argument");
      const remoteRequest = {
        ...params.request,
        arguments: applyMcpToolArgumentCredential({
          connection: params.connection,
          argumentsValue: asRecord(params.request.arguments) ?? {},
          expectedArgumentName: toolArgumentAuth?.kind === "api-key-tool-argument"
            ? toolArgumentAuth.argumentName
            : undefined,
        }),
      };
      return await connected.client.callTool(
        remoteRequest as never,
        {
          signal: params.signal,
          ...(params.toolDefinition ? { toolDefinition: params.toolDefinition } : {}),
          allowInputRequired: true,
        } as never,
      );
    }
    if (params.method === "resources/read") {
      return await connected.client.readResource(
        params.request as never,
        {
          signal: params.signal,
          cacheMode: "bypass",
          allowInputRequired: true,
        } as never,
      );
    }
    return await connected.client.getPrompt(
      params.request as never,
      {
        signal: params.signal,
        allowInputRequired: true,
      } as never,
    );
  } catch (error) {
    if (!isMcpCancellation(error, params.signal)) {
      await updateMcpConnectionStatus({
        connectionId: params.connection.id,
        status: mcpConnectionStatusForError(error),
        error,
        expectedVersion: params.connection.version,
        expectedStatuses: [params.connection.status, "READY"],
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    await connected.close().catch(() => undefined);
  }
}

function normalizeFinalResult(params: {
  connection: McpConnectionRecord;
  bindingId?: string;
  method: "tools/call" | "resources/read" | "prompts/get";
  originalRequest: Record<string, unknown>;
  result: unknown;
}): unknown {
  const server = params.connection.displayName;
  if (params.method === "tools/call") {
    const name =
      typeof params.originalRequest.name === "string"
        ? params.originalRequest.name
        : "unknown";
    return normalizeMcpToolResultForExecution(params.result, {
      connectionId: params.connection.id,
      bindingId: params.bindingId,
      providerKey: params.connection.providerKey,
      server,
      tool: name,
    });
  }
  return normalizeMcpMetaResultForExecution(params.result, {
    connectionId: params.connection.id,
    bindingId: params.bindingId,
    providerKey: params.connection.providerKey,
    server,
    operation:
      params.method === "resources/read" ? "read_resource" : "get_prompt",
  });
}

function claimFailure(status: string): never {
  if (status === "invalid_responses") {
    throw new HttpError(
      400,
      "INVALID_MESSAGE",
      "The MCP continuation response does not match the requested input",
    );
  }
  if (status === "already_used") {
    throw new HttpError(
      409,
      "INVALID_MESSAGE",
      "The MCP continuation has already been submitted",
    );
  }
  throw new HttpError(
    410,
    "INVALID_MESSAGE",
    "The MCP continuation is no longer available",
  );
}

export async function applyMcpContinuationResponses(params: {
  access: AgentChatAccess;
  conversationId: string;
  continuationId: string;
  responses: readonly McpContinuationResponse[];
  signal?: AbortSignal;
}): Promise<AppliedMcpContinuation> {
  const canonical = await findCanonicalContinuationMessage({
    access: params.access,
    conversationId: params.conversationId,
    continuationId: params.continuationId,
  });

  const claimed = await claimMcpContinuation({
    id: params.continuationId,
    appAccountId: params.access.appAccountId,
    agentDbId: params.access.agentDbId,
    responses: params.responses,
  });
  if (!claimed.ok) claimFailure(claimed.status);

  const connection = await getMcpConnection({
    appAccountId: params.access.appAccountId,
    connectionId: claimed.continuation.record.connectionId,
  });
  const source = claimed.continuation.payload.source ?? {};
  const sourceBindingId = typeof source.bindingId === "string" ? source.bindingId : null;
  const bindingId = claimed.continuation.record.bindingId;
  if (!connection || !sourceBindingId || sourceBindingId !== bindingId) {
    throw new HttpError(
      409,
      "TOOL_FAILED",
      "The MCP continuation is not bound to its exact originating assignment",
    );
  }
  let liveBindingAccess = await authorizeMcpBindingAccess({
    appAccountId: params.access.appAccountId,
    agentDbId: params.access.agentDbId,
    bindingId,
    connectionId: connection.id,
  });
  let authorizedTool: Awaited<ReturnType<typeof authorizeMcpInvocation>> | null = null;
  let expectedDescriptorId: string | null = null;
  let expectedSchemaHash: string | null = null;
  if (claimed.continuation.payload.method === "tools/call") {
    const toolName = claimed.continuation.payload.params.name;
    expectedDescriptorId = typeof source.descriptorId === "string" ? source.descriptorId : null;
    expectedSchemaHash = typeof source.schemaHash === "string" ? source.schemaHash : null;
    const storedDefinition = claimed.continuation.payload.toolDefinition;
    if (
      !expectedDescriptorId
      || !expectedSchemaHash
      || !storedDefinition
      || mcpToolSchemaHash(storedDefinition) !== expectedSchemaHash
    ) {
      throw new McpRuntimeError(
        "MCP_CATALOG_CHANGED",
        "MCP continuation is not bound to the exact authorized tool schema",
      );
    }
    const descriptor = typeof toolName === "string"
      ? await prisma.agentMcpToolDescriptor.findFirst({
          where: {
            id: expectedDescriptorId,
            connectionId: connection.id,
            name: toolName,
            active: true,
          },
        })
      : null;
    if (!descriptor) throw new McpRuntimeError("MCP_CATALOG_CHANGED", "MCP continuation tool is no longer active");
    authorizedTool = await authorizeMcpInvocation({
      appAccountId: params.access.appAccountId,
      agentDbId: params.access.agentDbId,
      bindingId,
      connectionId: connection.id,
      descriptorId: descriptor.id,
      expectedSchemaHash,
      input: claimed.continuation.payload.params.arguments ?? {},
    });
  }

  const request = retryParams({
    original: claimed.continuation.payload.params,
    requestState: claimed.continuation.payload.requestState,
    inputResponses: claimed.continuation.responses,
  });
  const requestBytes = byteLength(request);
  if (requestBytes > 256 * 1024) {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "MCP continuation request exceeds the platform byte limit");
  }
  const operation = claimed.continuation.payload.method;
  const runId = canonical.parentRunId;
  const startedAt = Date.now();
  const risk = authorizedTool?.descriptor.effectiveRisk ?? "READ_ONLY";
  const approvalMode = authorizedTool?.approvalMode ?? liveBindingAccess.binding.approvalMode;
  if (mcpRiskRequiresApproval(risk, approvalMode) && source.approvalGranted !== true) {
    throw new McpRuntimeError(
      "MCP_APPROVAL_REQUIRED",
      "The current MCP policy requires a fresh approved tool call",
    );
  }
  const descriptorId = authorizedTool?.descriptor.id ?? `meta:${operation}`;
  const maxCallsPerTool = authorizedTool?.maxCallsPerTool ?? liveBindingAccess.binding.maxCallsPerRun;
  const timeoutSignal = AbortSignal.timeout(liveBindingAccess.binding.callTimeoutMs);
  const signal = params.signal
    ? AbortSignal.any([params.signal, timeoutSignal])
    : timeoutSignal;
  let liveConnection = authorizedTool?.connection ?? liveBindingAccess.connection;

  const result = await (async (): Promise<unknown> => {
    try {
      await assertMcpCircuitAvailable(liveConnection.id);
      await enforceMcpInvocationLimits({
        appAccountId: params.access.appAccountId,
        agentDbId: params.access.agentDbId,
        connectionId: liveConnection.id,
        bindingId,
        descriptorId,
        runId,
        risk,
        maxCallsPerRun: liveBindingAccess.binding.maxCallsPerRun,
        maxCallsPerTool,
      });
      await writeMcpAudit({
        appAccountId: params.access.appAccountId,
        agentDbId: params.access.agentDbId,
        bindingId,
        connectionId: liveConnection.id,
        toolId: authorizedTool?.descriptor.id,
        action: "TOOL_CONTINUATION",
        status: "STARTED",
        metadata: {
          operation,
          runId,
          catalogRevision: liveConnection.catalogRevision,
          schemaHash: expectedSchemaHash,
          effectiveRisk: risk,
          approvalDecision: "continuation_user_input",
          requestBytes,
          inputHash: inputHash(request),
        },
      });
      const remoteResult = await withObservedMcpOperation({
        spanName: "mcp.invoke",
        operation: "continuation",
        providerKey: liveConnection.providerKey,
        risk,
        attributes: {
          "mcp.connection_id": liveConnection.id,
          "mcp.binding_id": bindingId,
          "mcp.catalog_revision": liveConnection.catalogRevision,
          "mcp.request_bytes": requestBytes,
        },
        task: async () => await withMcpInvocationConcurrency({
          appAccountId: params.access.appAccountId,
          connectionId: liveConnection.id,
          bindingId,
          maxParallelCalls: liveBindingAccess.binding.maxParallelCalls,
          signal,
          operation: async () => {
            if (operation === "tools/call") {
              authorizedTool = await authorizeMcpInvocation({
                appAccountId: params.access.appAccountId,
                agentDbId: params.access.agentDbId,
                bindingId,
                connectionId: connection.id,
                descriptorId: expectedDescriptorId!,
                expectedSchemaHash: expectedSchemaHash!,
                input: claimed.continuation.payload.params.arguments ?? {},
              });
              if (
                mcpRiskRequiresApproval(
                  authorizedTool.descriptor.effectiveRisk,
                  authorizedTool.approvalMode,
                )
                && source.approvalGranted !== true
              ) {
                throw new McpRuntimeError(
                  "MCP_APPROVAL_REQUIRED",
                  "The current MCP policy requires a fresh approved tool call",
                );
              }
              liveConnection = authorizedTool.connection;
              liveBindingAccess = {
                binding: authorizedTool.binding,
                connection: authorizedTool.connection,
              };
            } else {
              liveBindingAccess = await authorizeMcpBindingAccess({
                appAccountId: params.access.appAccountId,
                agentDbId: params.access.agentDbId,
                bindingId,
                connectionId: connection.id,
              });
              if (
                mcpRiskRequiresApproval("READ_ONLY", liveBindingAccess.binding.approvalMode)
                && source.approvalGranted !== true
              ) {
                throw new McpRuntimeError(
                  "MCP_APPROVAL_REQUIRED",
                  "The current MCP policy requires a fresh approved tool call",
                );
              }
              liveConnection = liveBindingAccess.connection;
            }
            return await invokeContinuation({
              connection: liveConnection,
              method: operation,
              request,
              toolDefinition: claimed.continuation.payload.toolDefinition,
              signal,
            });
          },
        }),
      });
      const responseBytes = byteLength(remoteResult);
      const credentialSafeResult = redactMcpCredentialEcho(liveConnection, remoteResult);
      const finalRisk = authorizedTool?.descriptor.effectiveRisk ?? risk;
      recordMcpToolBytes({
        providerKey: liveConnection.providerKey,
        risk: finalRisk,
        requestBytes,
        responseBytes,
      });
      const transactionResult = ["TRANSACTION_PREPARE", "TRADE"].includes(finalRisk);
      if (
        responseBytes > liveBindingAccess.binding.outputByteLimit
        && (operation !== "tools/call" || transactionResult)
      ) {
        throw new McpRuntimeError(
          "MCP_POLICY_BLOCKED",
          transactionResult
            ? "Unsigned transaction response exceeded the safe output limit and was rejected without truncation"
            : "MCP continuation response exceeds the configured output byte limit",
        );
      }
      const boundedResult = responseBytes > liveBindingAccess.binding.outputByteLimit
        ? boundExternalJson(credentialSafeResult, {
            ...DEFAULT_MCP_MODEL_BOUNDS,
            maxUtf8Bytes: liveBindingAccess.binding.outputByteLimit,
          }).value
        : credentialSafeResult;
      const pending = await persistInputRequiredResult({
        connection: liveConnection,
        agentDbId: params.access.agentDbId,
        bindingId,
        method: operation,
        requestParams: claimed.continuation.payload.params,
        result: boundedResult,
        toolDefinition: claimed.continuation.payload.toolDefinition,
        existingId: params.continuationId,
        rounds: claimed.continuation.record.rounds + 1,
        expectedFingerprint: claimed.continuation.record.fingerprint,
        source: {
          ...source,
          bindingId,
          serverName: liveConnection.displayName,
        },
      });
      if (operation === "tools/call" && !pending) {
        await assertMcpToolOutput(authorizedTool!.descriptor.outputSchema, credentialSafeResult);
      }
      const normalized = pending ?? normalizeFinalResult({
        connection: liveConnection,
        bindingId,
        method: operation,
        originalRequest: claimed.continuation.payload.params,
        result: boundedResult,
      });
      const executionResult = operation === "tools/call" && !pending
        ? enforceNativeTransactionBoundary({
            result: normalized,
            risk: finalRisk,
            providerKey: liveConnection.providerKey,
            connectionId: liveConnection.id,
          })
        : normalized;
      const unsignedTransactionProduced = asRecord(executionResult)?.status
        === "unsigned_transaction_requires_native_review";
      const transactionBlocked = asRecord(executionResult)?.status
        === "unsigned_transaction_blocked";
      await recordMcpCircuitSuccess(liveConnection.id);
      await writeMcpAudit({
        appAccountId: params.access.appAccountId,
        agentDbId: params.access.agentDbId,
        bindingId,
        connectionId: liveConnection.id,
        toolId: authorizedTool?.descriptor.id,
        action: "TOOL_CONTINUATION",
        status: transactionBlocked ? "BLOCKED" : "SUCCEEDED",
        reasonCode: transactionBlocked ? "MCP_POLICY_BLOCKED" : undefined,
        metadata: {
          operation,
          runId,
          effectiveRisk: finalRisk,
          durationMs: Date.now() - startedAt,
          requestBytes,
          responseBytes,
          retryCount: 0,
          unsignedTransactionProduced,
        },
      }).catch(() => undefined);
      return executionResult;
    } catch (error) {
      if (!isMcpCancellation(error, params.signal)) {
        await recordMcpCircuitFailure(liveConnection.id, error).catch(() => undefined);
        await writeMcpAudit({
          appAccountId: params.access.appAccountId,
          agentDbId: params.access.agentDbId,
          bindingId,
          connectionId: liveConnection.id,
          toolId: authorizedTool?.descriptor.id,
          action: "TOOL_CONTINUATION",
          status: "FAILED",
          reasonCode: mcpErrorCode(error),
          metadata: {
            operation,
            runId,
            durationMs: Date.now() - startedAt,
            requestBytes,
            retryCount: 0,
            error: safeMcpErrorDetails(error),
          },
        }).catch(() => undefined);
      }
      throw error;
    }
  })();

  const patched = replaceContinuationResult(
    canonical.parts,
    params.continuationId,
    result,
    { nodes: MAX_PART_SCAN_NODES },
  );
  if (!patched.replaced || !Array.isArray(patched.value)) {
    throw new McpRuntimeError(
      "MCP_CONTINUATION_CONTEXT_MISSING",
      "The canonical MCP tool result could not be resumed",
    );
  }

  const [validatedPatchedMessage] = await validateAgentChatUIMessages([
    {
      id: canonical.id,
      role: "assistant",
      parts: patched.value,
    },
  ]);
  if (!validatedPatchedMessage) {
    throw new McpRuntimeError(
      "MCP_CONTINUATION_CONTEXT_MISSING",
      "The resumed MCP tool result produced an invalid UI message",
    );
  }

  await prisma.agentChatMessage.update({
    where: { id: canonical.id },
    data: {
      parts: validatedPatchedMessage.parts as Prisma.InputJsonValue,
      ...projectMessageSearchFields(validatedPatchedMessage.parts),
    },
  });

  return {
    ...canonical,
    parts: validatedPatchedMessage.parts,
    conversationId: params.conversationId,
    continuationRequestId: continuationRequestId({
      appAccountId: params.access.appAccountId,
      agentDbId: params.access.agentDbId,
      conversationId: params.conversationId,
      continuationId: params.continuationId,
      responses: params.responses,
    }),
    status:
      asRecord(result)?.status === "input_required"
        ? "input_required"
        : asRecord(result)?.status === "unsupported_input_required"
          ? "blocked"
          : "resumed",
    result,
  };
}
