import { addAbortListener } from "node:events";
import type { ToolSet } from "ai";
import { getSolanaAgentKitTools } from "./solana-agent-kit";
import { buildProductWalletTools } from "./product-wallet-tools";
import { buildAgentCardTools } from "./agentcard-tools";
import { buildAgentContextTools } from "./context-tools";
import { isAgentCardConfigured } from "@/lib/agent-trading/agentcard";
import {
  createMcpRuntime,
  type McpRuntime,
  type McpRuntimeInstruction,
  type McpRuntimeWarning,
} from "../mcp/runtime-manager";
import { executeIdempotentSideEffect } from "./side-effect-idempotency";
import { withToolExecutionSpan } from "../observability";
import type { ToolRuntimePolicy } from "../../shared/types";
import { getDefaultToolPolicy } from "./policy";
import { copyToolEffect, getToolEffect } from "./tool-effects";
import { copyMcpToolMetadata, getMcpToolMetadata } from "../mcp/tool-metadata";
import {
  beginToolEvent,
  finishToolEvent,
  toolEventStateForResult,
  type ToolEventSourceMetadata,
} from "../repositories/tool-events";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import { resolveToolContextPolicy, type ToolContextPolicy } from "./tool-context-policy";
import { mcpExecutionHasApprovedToolCall } from "../mcp/policy-service";
import { mcpRiskRequiresApproval } from "../mcp/risk";
type ExecutableTool = {
  execute?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};
function withAbortSignal(args: unknown[], signal: AbortSignal): unknown[] {
  const next = [...args];
  const currentOptions = next[1];
  next[1] =
    currentOptions && typeof currentOptions === "object" && !Array.isArray(currentOptions)
      ? { ...currentOptions, abortSignal: signal }
      : { abortSignal: signal };
  return next;
}
export type ToolRuntime = {
  callCount: number;
  timedOutCount: number;
};

export type ToolEventLifecycle = {
  runId: string;
  responseMessageId: string;
  getStepIndex(): number;
  onStarted?(event: {
    toolCallId: string;
    toolName: string;
    stepIndex: number;
    sourceMetadata?: ToolEventSourceMetadata;
  }): void;
  onFinished?(event: {
    toolCallId: string;
    toolName: string;
    stepIndex: number;
    state: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
    durationMs: number;
    sourceMetadata?: ToolEventSourceMetadata;
  }): void;
  projectOutput?(event: {
    toolCallId: string;
    toolName: string;
    output: unknown;
    stateChanging: boolean;
    policy: ToolContextPolicy;
    sourceMetadata?: ToolEventSourceMetadata;
  }): Promise<{
    modelOutput: unknown;
    persistenceOutput?: unknown;
    artifactId?: string;
    externalized?: boolean;
  }>;
};
export class ToolTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(`Tool ${toolName} timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
  }
}
export class ToolCancelledError extends Error {
  constructor(toolName: string) {
    super(`Tool ${toolName} was cancelled`);
    this.name = "ToolCancelledError";
  }
}

function mergeMcpToolsWithoutShadowing(
  localTools: ToolSet,
  mcpRuntime: McpRuntime,
): { tools: ToolSet; warnings: McpRuntimeWarning[] } {
  const tools: ToolSet = { ...localTools };
  const warnings = [...mcpRuntime.warnings];
  for (const [name, value] of Object.entries(mcpRuntime.tools)) {
    if (Object.hasOwn(tools, name)) {
      const metadata = getMcpToolMetadata(value);
      warnings.push({
        connectionId: metadata?.connectionId ?? "runtime",
        code: "MCP_CONFIGURATION_INVALID",
        message: "An MCP tool was omitted because its runtime name conflicts with a native tool. Other MCP and native tools remain available.",
      });
      continue;
    }
    tools[name] = value;
  }
  return { tools, warnings };
}

function wrapToolsWithPolicy(
  rawTools: ToolSet,
  policy: ToolRuntimePolicy,
  runtime: ToolRuntime,
  abortSignal?: AbortSignal,
  eventLifecycle?: ToolEventLifecycle,
): ToolSet {
  const tools: ToolSet = {};
  for (const [name, value] of Object.entries(rawTools)) {
    const original = value as ExecutableTool;
    const execute = original.execute;
    if (execute) {
      const wrapped = {
        ...original,
        execute: async (...args: unknown[]) => {
          runtime.callCount += 1;
          if (runtime.callCount > policy.maxToolCallsPerRun) {
            throw new Error(
              `Tool call limit (${policy.maxToolCallsPerRun}) exceeded`,
            );
          }
          const timeoutSignal = AbortSignal.timeout(policy.perToolTimeoutMs);
          const compositeSignal = abortSignal
            ? AbortSignal.any([abortSignal, timeoutSignal])
            : timeoutSignal;
          const abortError = () =>
            compositeSignal.reason === timeoutSignal.reason
              ? new ToolTimeoutError(name, policy.perToolTimeoutMs)
              : new ToolCancelledError(name);
          const initialOptions = args[1] as
            | { toolCallId?: unknown }
            | undefined;
          let lifecycleToolCallId =
            typeof initialOptions?.toolCallId === "string"
              ? initialOptions.toolCallId
              : undefined;
          let lifecycleStepIndex = eventLifecycle?.getStepIndex() ?? 0;
          let toolStartedAt = Date.now();
          let lifecycleSourceMetadata: ToolEventSourceMetadata | undefined;
          try {
            if (compositeSignal.aborted) throw abortError();
            const aborted = Promise.withResolvers<never>();
            using _abortListener = addAbortListener(compositeSignal, () => {
              aborted.reject(abortError());
            });
            const executionArgs = withAbortSignal(args, compositeSignal);
            const executionOptions = executionArgs[1] as
              | { context?: { runId?: unknown }; toolCallId?: unknown }
              | undefined;
            const runId =
              typeof executionOptions?.context?.runId === "string"
                ? executionOptions.context.runId
                : undefined;
            const toolCallId =
              typeof executionOptions?.toolCallId === "string"
                ? executionOptions.toolCallId
                : lifecycleToolCallId;
            lifecycleToolCallId = toolCallId;
            const mcp = getMcpToolMetadata(value);
            const mcpExecutionSource = mcp?.resolveExecutionSource?.(executionArgs[0]);
            const effectiveRisk = mcpExecutionSource?.effectiveRisk ?? mcp?.effectiveRisk;
            const approvalMode = mcpExecutionSource?.approvalMode
              ?? mcp?.approvalMode
              ?? "BLOCK_ALL";
            const approved = Boolean(mcp) && mcpExecutionHasApprovedToolCall(executionOptions);
            const approvalRequired = Boolean(
              mcp
              && mcpRiskRequiresApproval(
                effectiveRisk ?? (mcp.stateChanging ? "UNKNOWN" : "READ_ONLY"),
                approvalMode,
              ),
            );
            const approvalDecision = approved
              ? "USER_APPROVED"
              : approvalRequired
                ? "MISSING_REQUIRED_APPROVAL"
                : "AUTO_ALLOWED";
            const sourceMetadata = mcp
              ? {
                  toolSource: "mcp",
                  sourceConnectionId:
                    mcpExecutionSource?.connectionId
                    ?? (mcp.connectionId === "runtime" ? undefined : mcp.connectionId),
                  sourceProviderKey:
                    mcpExecutionSource?.providerKey ?? mcp.providerKey,
                  sourceToolName:
                    mcpExecutionSource?.externalToolName ?? mcp.externalToolName,
                  sourceDisplayName:
                    mcpExecutionSource?.serverName ?? mcp.serverName,
                  sourceBindingId:
                    mcpExecutionSource?.bindingId ?? mcp.bindingId,
                  sourceDescriptorId:
                    mcpExecutionSource?.descriptorId ?? mcp.descriptorId,
                  catalogRevision:
                    mcpExecutionSource?.catalogRevision ?? mcp.catalogRevision,
                  schemaHash:
                    mcpExecutionSource?.schemaHash ?? mcp.schemaHash,
                  effectiveRisk,
                  approvalDecision,
                }
              : { toolSource: "local" };
            lifecycleStepIndex = eventLifecycle?.getStepIndex() ?? lifecycleStepIndex;
            toolStartedAt = Date.now();
            lifecycleSourceMetadata = sourceMetadata;
            if (eventLifecycle && toolCallId) {
              eventLifecycle.onStarted?.({
                toolCallId,
                toolName: name,
                stepIndex: lifecycleStepIndex,
                sourceMetadata,
              });
              await beginToolEvent({
                runId: eventLifecycle.runId,
                responseMessageId: eventLifecycle.responseMessageId,
                stepIndex: lifecycleStepIndex,
                toolCallId,
                toolName: name,
                input: executionArgs[0],
                redactInput: policy.redactInputForTools.includes(name),
                sourceMetadata,
              }).catch((error) => {
                console.warn("[agent-chat] failed to persist tool start", {
                  runId: eventLifecycle.runId,
                  toolCallId,
                  error: safeErrorDetails(error),
                });
              });
            }
            const declaredStateChanging = getToolEffect(value)?.stateChanging;
            const stateChanging = declaredStateChanging ?? false;
            const execution = withToolExecutionSpan({
              runId,
              toolName: name,
              stateChanging,
              execute: () => stateChanging
                ? executeIdempotentSideEffect(name, executionArgs, execute)
                : Promise.try(() => execute(...executionArgs)),
            });
            const result = await Promise.race([execution, aborted.promise]);
            const contextPolicy = resolveToolContextPolicy({
              toolName: name,
              tool: value,
              stateChanging: declaredStateChanging,
            });
            let projected: Awaited<ReturnType<NonNullable<ToolEventLifecycle["projectOutput"]>>> | undefined;
            if (eventLifecycle && toolCallId && eventLifecycle.projectOutput) {
              projected = await eventLifecycle.projectOutput({
                toolCallId,
                toolName: name,
                output: result,
                stateChanging,
                policy: contextPolicy,
                sourceMetadata,
              }).catch((error) => {
                console.warn("[agent-chat] failed to virtualize tool result; returning inline result", {
                  runId: eventLifecycle.runId,
                  toolCallId,
                  error: safeErrorDetails(error),
                });
                return undefined;
              });
            }
            const modelResult = projected?.modelOutput ?? result;
            if (eventLifecycle && toolCallId) {
              const terminalState = toolEventStateForResult(result);
              eventLifecycle.onFinished?.({
                toolCallId,
                toolName: name,
                stepIndex: lifecycleStepIndex,
                state: terminalState,
                durationMs: Date.now() - toolStartedAt,
                sourceMetadata,
              });
              await finishToolEvent({
                runId: eventLifecycle.runId,
                toolCallId,
                toolName: name,
                state: terminalState,
                output: projected?.persistenceOutput ?? modelResult,
                summary: projected?.externalized ? modelResult : undefined,
                resultArtifactId: projected?.artifactId,
              }).catch((error) => {
                console.warn("[agent-chat] failed to persist tool completion", {
                  runId: eventLifecycle.runId,
                  toolCallId,
                  error: safeErrorDetails(error),
                });
              });
            }
            return modelResult;
          } catch (error) {
            let terminalError = error;
            let terminalState: "FAILED" | "TIMED_OUT" | "CANCELLED" = "FAILED";
            if (timeoutSignal.aborted) {
              runtime.timedOutCount += 1;
              terminalState = "TIMED_OUT";
              terminalError =
                error instanceof ToolTimeoutError
                  ? error
                  : new ToolTimeoutError(name, policy.perToolTimeoutMs);
            } else if (abortSignal?.aborted) {
              terminalState = "CANCELLED";
              terminalError =
                error instanceof ToolCancelledError
                  ? error
                  : new ToolCancelledError(name);
            }
            if (eventLifecycle && lifecycleToolCallId) {
              eventLifecycle.onFinished?.({
                toolCallId: lifecycleToolCallId,
                toolName: name,
                stepIndex: lifecycleStepIndex,
                state: terminalState,
                durationMs: Date.now() - toolStartedAt,
                sourceMetadata: lifecycleSourceMetadata,
              });
              await finishToolEvent({
                runId: eventLifecycle.runId,
                toolCallId: lifecycleToolCallId,
                toolName: name,
                state: terminalState,
                error: terminalError,
              }).catch((persistenceError) => {
                console.warn("[agent-chat] failed to persist tool failure", {
                  runId: eventLifecycle.runId,
                  toolCallId: lifecycleToolCallId,
                  error: safeErrorDetails(persistenceError),
                });
              });
            }
            throw terminalError;
          }
        },
      } as ToolSet[string];
      copyToolEffect(value, wrapped);
      copyMcpToolMetadata(value, wrapped as object);
      (tools as Record<string, unknown>)[name] = wrapped;
    } else {
      (tools as Record<string, unknown>)[name] = original;
    }
  }
  return tools;
}
export type AgentChatToolRuntime = {
  tools: ToolSet;
  mcpInstructions: readonly McpRuntimeInstruction[];
  mcpWarnings: readonly McpRuntimeWarning[];
  close(): Promise<void>;
};

export async function buildAgentChatToolRuntime(params: {
  agentDbId: number;
  appAccountId: string;
  userProfileId: number;
  policy?: Partial<ToolRuntimePolicy>;
  runtime?: ToolRuntime;
  abortSignal?: AbortSignal;
  eventLifecycle?: ToolEventLifecycle;
  additionalTools?: ToolSet;
}): Promise<AgentChatToolRuntime> {
  const {
    policy: policyOverrides,
    runtime = { callCount: 0, timedOutCount: 0 },
    abortSignal,
  } = params;
  const defaults = getDefaultToolPolicy();
  const policy = { ...defaults, ...policyOverrides };
  policy.maxToolCallsPerRun = Number.isFinite(policy.maxToolCallsPerRun)
    ? Math.max(1, Math.trunc(policy.maxToolCallsPerRun))
    : defaults.maxToolCallsPerRun;
  policy.perToolTimeoutMs = Number.isFinite(policy.perToolTimeoutMs)
    ? Math.max(1, Math.trunc(policy.perToolTimeoutMs))
    : defaults.perToolTimeoutMs;

  const productTools = buildProductWalletTools();
  const agentCardTools = isAgentCardConfigured() ? buildAgentCardTools() : {};
  const contextTools = buildAgentContextTools();
  let mcpRuntime: McpRuntime | null = null;
  const mcpRuntimePromise = createMcpRuntime({
    agentDbId: params.agentDbId,
    appAccountId: params.appAccountId,
    abortSignal,
  });
  try {
    const [sakTools, createdMcpRuntime] = await Promise.all([
      getSolanaAgentKitTools(),
      mcpRuntimePromise,
    ]);
    mcpRuntime = createdMcpRuntime;
    const merged = mergeMcpToolsWithoutShadowing({
      ...sakTools,
      ...productTools,
      ...agentCardTools,
      ...contextTools,
      ...(params.additionalTools ?? {}),
    }, createdMcpRuntime);
    const tools = wrapToolsWithPolicy(
      merged.tools,
      policy,
      runtime,
      abortSignal,
      params.eventLifecycle,
    );
    let closed = false;
    return {
      tools,
      mcpInstructions: createdMcpRuntime.instructions,
      mcpWarnings: merged.warnings,
      async close() {
        if (closed) return;
        closed = true;
        await createdMcpRuntime.close();
      },
    };
  } catch (error) {
    // Promise.all may reject because SAK initialization failed before the MCP
    // promise was assigned to `mcpRuntime`. Await the MCP promise here so a
    // successfully-created remote runtime is never orphaned.
    const createdMcpRuntime = mcpRuntime ?? await mcpRuntimePromise.catch(() => null);
    await createdMcpRuntime?.close().catch(() => undefined);
    throw error;
  }
}

export { getDefaultToolPolicy } from "./policy";
