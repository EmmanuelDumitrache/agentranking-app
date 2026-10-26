import {
  ToolLoopAgent,
  consumeStream,
  createAgentUIStream,
  createUIMessageStreamResponse,
  isStepCount,
  type InferUIMessageChunk,
  type LanguageModel,
  type ToolSet,
} from "ai";
import { setTimeout as delay } from "node:timers/promises";
import { resolveAgentChatRuntime } from "@/lib/llm-provider/agent-chat-model";
import type { ProviderModelRuntime } from "@/lib/llm-provider/credentials/provider-adapter";
import { createByokFailoverLanguageModel } from "@/lib/llm-provider/failover-language-model";
import { prisma } from "@/lib/db";
import { runPeriodicTask } from "@/lib/timing/periodic-task";
import type {
  AgentChatAccess,
  AgentChatStreamRequest,
} from "../../shared/contracts";
import { getModelOrThrow } from "../model-registry";
import {
  buildCapabilityFocus,
  buildCapabilityMap,
  buildDynamicAgentContextSections,
  buildSystemPrompt,
} from "../prompts";
import { loadAgentChatContext } from "../agent-context";
import {
  buildAgentChatToolRuntime,
  getDefaultToolPolicy,
  type AgentChatToolRuntime,
} from "../tools";
import { getMcpToolMetadata } from "../mcp/tool-metadata";
import { mcpRiskRequiresApproval } from "../mcp/risk";
import { stopOnMcpInputRequired } from "../mcp/runtime-manager";
import { McpRuntimeError } from "../mcp/errors";
import { loadConversationHistory } from "../history";
import { HttpError } from "../http-error";
import {
  estimateContinuationInputTokenDemand,
  estimateRunInputTokenDemand,
  startContinuationRun,
  startRun,
} from "./start-run";
import { applyToolApprovalResponses } from "./tool-approval-continuation";
import { applyMcpContinuationResponses } from "./mcp-continuation";
import { createMcpInputRequiredResponse } from "./mcp-input-required-response";
import { settleRun } from "./settle-run";
import {
  bindAgentChatToolContext,
  buildAgentChatToolContext,
} from "../tools/context";
import { register, unregister } from "./abort-registry";
import * as telemetry from "../telemetry";
import {
  isToolCatalogQuery,
  profileAgentTask,
} from "../orchestration/task-profile";
import {
  isAgentCardToolName,
  redactAgentCardPayload,
} from "@/lib/agent-trading/agentcard";
import {
  buildAgentRoutingPlan,
  modelSatisfiesRoutingRequirements,
  rankModelsByCacheAffinity,
} from "../orchestration/routing";
import {
  createAgentPrepareStep,
  createAgentOrchestrationState,
  getAgentStepOutputTokenLimit,
} from "../orchestration/prepare-step";
import {
  MAX_ACTIVE_TOOL_COUNT,
  rankToolCatalogSemantically,
  selectActiveToolNames,
} from "../orchestration/tool-selection";
import {
  buildRuntimeSelectionMetadata,
  buildSelectionMetadata,
} from "../tools/selection-metadata";
import {
  composeAgentTools,
  getAgentRuntimeToolMetadata,
  isWebSearchRuntimeTool,
} from "../tools/provider-tools";
import { createRepairToolCall } from "../tools/repair-tool-call";
import { inspectRuntimeToolCatalog } from "../tools/runtime-tool-discovery-core";
import { buildRuntimeDiscoveryTools } from "../tools/runtime-discovery-tools";
import { buildIsolatedSubagentTools } from "../tools/subagent-tools";
import { runIsolatedReadOnlySubagent } from "./isolated-subagent";
import {
  emitTaskProfiled,
  emitModelRouted,
  emitStepPrepared,
  emitToolsSelected,
} from "../telemetry";
import { toolEventStateForResult } from "../repositories/tool-events";
import {
  projectToolOutputsForPersistence,
  projectToolResultForModel,
} from "../repositories/tool-result-artifacts";
import { resolveToolContextPolicy } from "../tools/tool-context-policy";
import { getToolEffect } from "../tools/tool-effects";
import { getCanonicalUserMessage } from "../repositories/messages";
import {
  recordWorkingObjective,
  resolveTaskControlText,
} from "../working-state";
import { compactConversationContextSafely } from "../conversation-summary";
import { redactSensitiveData, safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import {
  isProviderRuntimeFailure,
} from "@/lib/llm-provider/provider-failure";
import { markByokCredentialInvalid } from "@/lib/llm-provider/credentials/service";
import {
  beginRunAttempt,
  completeRunAttempt,
  failRunAttempt,
} from "../repositories/attempts";
import { AgentRunAttemptTracker } from "./attempt-tracker";
import {
  estimatePreRunToolReserveTokens,
  estimateToolSchemaTokenCosts,
  sumToolSchemaTokenCosts,
  TOOL_REQUEST_ENVELOPE_TOKENS,
} from "./token-budget";
import { toolSchemaSelectionBudgetTokens } from "./context-budget";
import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
import { canUsePlatformSemanticRanking } from "../control-plane-model";
import {
  extractTextContent,
  type AgentChatUIMessage,
} from "../../shared/ui-message";
type ToolEvent = {
  toolCallId: string;
  toolName: string;
  state: "PENDING" | "SUCCEEDED" | "FAILED";
  inputJson?: unknown;
  outputJson?: unknown;
  stepIndex: number;
  toolSource?: string;
  sourceConnectionId?: string;
  sourceToolName?: string;
  sourceDisplayName?: string;
  resultArtifactId?: string;
};
const RUNTIME_LEASE_MS = 10_000;
async function settleReliably(...args: Parameters<typeof settleRun>) {
  let lastError: unknown;
  for (const delayMs of [0, 75, 300]) {
    if (delayMs) await delay(delayMs, undefined, { ref: false });
    try {
      return await settleRun(...args);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
function watchDurableCancellation(
  runId: string,
  workerId: string,
  controller: AbortController,
): () => void {
  const watcherController = new AbortController();
  const stop = () => watcherController.abort(controller.signal.reason);
  if (controller.signal.aborted) stop();
  else controller.signal.addEventListener("abort", stop, { once: true });
  const loop = runPeriodicTask({
    signal: watcherController.signal,
    intervalMs: 1_500,
    task: async () => {
      const now = new Date();
      const [updated, runtime, run] = await prisma.$transaction([
        prisma.agentChatRunRuntime.updateMany({
          where: { runId, workerId },
          data: {
            heartbeatAt: now,
            leaseExpiresAt: new Date(now.getTime() + RUNTIME_LEASE_MS),
          },
        }),
        prisma.agentChatRunRuntime.findUnique({
          where: { runId },
          select: { abortRequestedAt: true, workerId: true },
        }),
        prisma.agentChatRun.findUnique({
          where: { id: runId },
          select: { status: true },
        }),
      ]);
      if (watcherController.signal.aborted) return;
      if (
        updated.count !== 1 ||
        runtime?.workerId !== workerId ||
        runtime.abortRequestedAt ||
        !run ||
        !["RESERVED", "STREAMING"].includes(run.status)
      ) {
        controller.abort("durable-cancellation");
      }
    },
    onError: (error) => {
      console.error("[agent-chat] runtime lease heartbeat failed", {
        runId,
        error: safeErrorDetails(error),
      });
    },
  });
  void loop.catch((error) => {
    if (!watcherController.signal.aborted) {
      console.error("[agent-chat] runtime lease watcher stopped", {
        runId,
        error: safeErrorDetails(error),
      });
    }
  });
  return () => {
    controller.signal.removeEventListener("abort", stop);
    watcherController.abort("watcher-stopped");
  };
}

function sanitizeToolOutputForPersistence(
  toolName: string,
  output: unknown,
): unknown {
  const toolRedacted = isAgentCardToolName(toolName)
    ? redactAgentCardPayload(output)
    : output;
  return redactSensitiveData(toolRedacted);
}

async function persistToolEvents(
  runId: string,
  responseMessageId: string,
  events: ToolEvent[],
): Promise<void> {
  for (const event of events) {
    const outputJson = sanitizeToolOutputForPersistence(
      event.toolName,
      event.outputJson,
    );
    const completedAt = event.state === "PENDING" ? null : new Date();
    await prisma.agentChatToolEvent.createMany({
      data: [{
        runId,
        responseMessageId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        state: event.state,
        inputJson: redactSensitiveData(event.inputJson) as never,
        outputJson: outputJson as never,
        stepIndex: event.stepIndex,
        toolSource: event.toolSource,
        sourceConnectionId: event.sourceConnectionId,
        sourceToolName: event.sourceToolName,
        sourceDisplayName: event.sourceDisplayName,
        resultArtifactId: event.resultArtifactId,
        completedAt,
      }],
      skipDuplicates: true,
    });
    // Execution-time lifecycle persistence is authoritative. This end-of-step
    // path is only a recovery/fill-in mechanism, so never overwrite a richer
    // TIMED_OUT/CANCELLED/SUCCEEDED/FAILED terminal state already recorded by
    // the execute wrapper.
    await prisma.agentChatToolEvent.updateMany({
      where: {
        runId,
        toolCallId: event.toolCallId,
        state: event.state === "PENDING"
          ? "PENDING"
          : { in: ["PENDING", "RUNNING"] },
      },
      data: {
        state: event.state,
        outputJson: outputJson as never,
        toolSource: event.toolSource,
        sourceConnectionId: event.sourceConnectionId,
        sourceToolName: event.sourceToolName,
        sourceDisplayName: event.sourceDisplayName,
        resultArtifactId: event.resultArtifactId,
        completedAt,
      },
    });
  }
}
async function persistToolEventsReliably(
  runId: string,
  responseMessageId: string,
  events: ToolEvent[],
): Promise<boolean> {
  if (events.length === 0) return true;
  let lastError: unknown;
  for (const delayMs of [0, 75, 300]) {
    if (delayMs) await delay(delayMs, undefined, { ref: false });
    try {
      await persistToolEvents(runId, responseMessageId, events);
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("[agent-chat] tool event persistence exhausted retries", {
    runId,
    eventCount: events.length,
    error: safeErrorDetails(lastError),
  });
  return false;
}
export async function handleChatStream(
  body: AgentChatStreamRequest,
  access: AgentChatAccess,
  requestSignal?: AbortSignal,
): Promise<Response> {
  const startedAt = Date.now();
  const requestedModel = await getModelOrThrow(body.modelKey, {
    appAccountId: access.appAccountId,
  });

  let userText: string;
  let userParts: AgentChatUIMessage["parts"];
  let estimatedInputTokens: number;
  let userMessage: AgentChatUIMessage | undefined;
  let continuation:
    | {
        conversationId: string;
        triggerMessageId: string;
        parentRunId: string;
        requestId: string;
        triggerKind: "TOOL_APPROVAL" | "MCP_INPUT";
      }
    | undefined;

  if (body.kind === "tool-approval") {
    const applied = await applyToolApprovalResponses({
      access,
      conversationId: body.conversationId,
      assistantUiMessageId: body.assistantUiMessageId,
      approvals: body.approvals,
    });
    userText = applied.initiatingUserText;
    userParts = applied.initiatingUserParts;
    estimatedInputTokens = await estimateContinuationInputTokenDemand(
      access,
      body.conversationId,
    );
    continuation = {
      conversationId: body.conversationId,
      triggerMessageId: applied.triggerMessageId,
      parentRunId: applied.parentRunId,
      requestId: applied.continuationRequestId,
      triggerKind: "TOOL_APPROVAL",
    };
  } else if (body.kind === "mcp-continuation") {
    const applied = await applyMcpContinuationResponses({
      access,
      conversationId: body.conversationId,
      continuationId: body.continuationId,
      responses: body.responses,
      signal: requestSignal,
    });
    if (applied.status !== "resumed") {
      return createMcpInputRequiredResponse({
        applied,
        modelKey: body.modelKey,
      });
    }
    userText = applied.initiatingUserText;
    userParts = applied.initiatingUserParts;
    estimatedInputTokens = await estimateContinuationInputTokenDemand(
      access,
      body.conversationId,
    );
    continuation = {
      conversationId: body.conversationId,
      triggerMessageId: applied.triggerMessageId,
      parentRunId: applied.parentRunId,
      requestId: applied.continuationRequestId,
      triggerKind: "MCP_INPUT",
    };
  } else {
    const message =
      body.triggerKind === "REGENERATE"
        ? await getCanonicalUserMessage(
            access,
            body.conversationId,
            body.message.id,
          )
        : body.message;
    if (!message) {
      throw new HttpError(
        409,
        "INVALID_MESSAGE",
        "The regeneration source message is no longer available",
      );
    }
    userMessage = message;
    const hasFile = message.parts.some((part) => part.type === "file");
    if (hasFile && !requestedModel.capabilities.attachments) {
      throw new HttpError(
        400,
        "MODEL_CAPABILITY_MISMATCH",
        "The selected model does not accept attachments",
      );
    }
    userText = extractTextContent(message);
    userParts = message.parts;
    if (body.triggerKind !== "REGENERATE") {
      await compactConversationContextSafely(body.conversationId, {
        model: requestedModel,
      });
    }
    estimatedInputTokens = await estimateRunInputTokenDemand(
      access,
      message,
      body.conversationId,
      body.triggerKind === "REGENERATE"
        ? {
            messageAlreadyPersisted: true,
            throughMessageId: message.id,
          }
        : undefined,
    );
  }

  // The transcript keeps the literal user turn, but deterministic control-plane
  // routing needs the prior structured objective for deictic follow-ups such as
  // "continue" or "retry". This avoids collapsing a tool-heavy task into a
  // synthesis-only profile merely because the latest text is context-dependent.
  const taskControlText = await resolveTaskControlText(
    body.conversationId,
    userText,
  );
  const profile = profileAgentTask({
    text: taskControlText,
    parts: userParts,
  });
  const catalogEnumeration =
    profile.catalogQuery || isToolCatalogQuery(taskControlText);
  const initialRoutingPhase = profile.requiresTools ? "DISCOVERY" : "SYNTHESIS";
  const routingPlan = await buildAgentRoutingPlan({
    requestedModelKey: body.modelKey,
    profile,
    appAccountId: access.appAccountId,
    estimatedInputTokens,
    reservedOutputTokens: getAgentStepOutputTokenLimit(
      requestedModel,
      profile,
      initialRoutingPhase,
    ),
    reservedToolTokens: estimatePreRunToolReserveTokens(profile.requiresTools),
  });
  let run;
  if (body.kind === "tool-approval" || body.kind === "mcp-continuation") {
    if (!continuation) {
      throw new HttpError(
        409,
        "INVALID_MESSAGE",
        "Continuation state is unavailable",
      );
    }
    run = await startContinuationRun(access, routingPlan, {
      conversationId: continuation.conversationId,
      triggerMessageId: continuation.triggerMessageId,
      parentRunId: continuation.parentRunId,
      requestId: continuation.requestId,
      estimatedInputTokens,
      triggerKind: continuation.triggerKind,
      additionalModelCalls:
        profile.complexity === "high" && routingPlan.primaryModel.capabilities.tools ? 1 : 0,
    });
  } else {
    run = await startRun(
      access,
      routingPlan,
      userMessage ?? body.message,
      body.requestId,
      body.conversationId,
      {
        estimatedInputTokens,
        triggerKind: body.triggerKind ?? "USER_MESSAGE",
        additionalModelCalls:
          profile.complexity === "high" && routingPlan.primaryModel.capabilities.tools ? 1 : 0,
      },
    );
  }
  if (run.replayed)
    throw new HttpError(
      409,
      "RUN_ALREADY_ACTIVE",
      "This request was already accepted",
      true,
    );
  await prisma.agentChatRun.update({
    where: { id: run.runId },
    data: { status: "STREAMING" },
  });
  if (body.kind === "message" && body.triggerKind !== "REGENERATE") {
    await recordWorkingObjective(run.conversationId, userText);
  }
  emitTaskProfiled({
    runId: run.runId,
    taskDomains: profile.domains.map(String),
    phase: "profiling",
    webSearchActive: profile.requiresCurrentWeb,
    catalogQuery: profile.catalogQuery,
  });
  emitModelRouted({
    runId: run.runId,
    requestedModel: body.modelKey,
    effectiveModel: routingPlan.primaryModel.providerModelId,
    routingReason: routingPlan.reason,
  });
  await telemetry.trackRunStarted({
    runId: run.runId,
    threadId: run.conversationId,
    agentDbId: access.agentDbId,
    appAccountId: access.appAccountId,
    provider: routingPlan.primaryModel.provider,
    model: routingPlan.primaryModel.providerModelId,
  });
  const controller = new AbortController();
  register(run.runId, controller);
  // The HTTP request lifetime is deliberately NOT the model-run lifetime.
  // Refreshing, closing a tab, or transiently losing the network aborts the
  // browser fetch, but the run is durable and its final response is persisted
  // in PostgreSQL. Keep the provider running so a refreshed client can recover
  // from the persisted active-run state. Explicit Stop requests are propagated
  // through cancelRun() -> abortRequestedAt -> this durable watcher instead.
  const stopWatcher = watchDurableCancellation(
    run.runId,
    run.workerId,
    controller,
  );
  const toolEvents: ToolEvent[] = [];
  const toolExecutionUi = new Map<string, { durationMs: number; state: string }>();
  const routeModels = [routingPlan.primaryModel, ...routingPlan.fallbackModels];
  const failedPhysicalModelKeys = new Set<string>();
  const failedCredentialProviders = new Set<string>();
  const credentialProviderId = (model: AgentChatModelDefinition) =>
    model.credentialProvider ?? model.provider;
  const persistCredentialInvalidation = async (
    model: AgentChatModelDefinition,
    failure: Parameters<typeof markByokCredentialInvalid>[0]["failure"],
  ): Promise<void> => {
    await markByokCredentialInvalid({
      appAccountId: access.appAccountId,
      model,
      ...(failure ? { failure } : {}),
    }).catch((credentialError) => {
      console.warn("[agent-chat] failed to persist BYOK credential invalidation", {
        runId: run.runId,
        provider: credentialProviderId(model),
        error: safeErrorDetails(credentialError),
      });
    });
  };
  const attemptTracker = new AgentRunAttemptTracker();
  const attemptReasonById = new Map<string, string>();
  const lastFailedModelByStep = new Map<number, string>();
  let physicalFailoverUsed = false;
  let currentFailureModelKey = routingPlan.primaryModel.modelKey;
  let stepIndex = 0;
  let terminalPromise: Promise<void> | undefined;
  let firstTokenAt: Date | undefined;
  let toolRuntime: AgentChatToolRuntime | null = null;
  const cleanup = async () => {
    await toolRuntime?.close().catch((error) => {
      console.warn("[agent-chat] failed to close tool runtime", {
        runId: run.runId,
        error: safeErrorDetails(error),
      });
    });
    controller.signal.removeEventListener("abort", onControllerAbort);
    stopWatcher();
    unregister(run.runId);
  };
  const currentFailureModel = () =>
    routeModels.find((model) => model.modelKey === currentFailureModelKey) ??
    routingPlan.primaryModel;
  const settleFailure = (error: unknown) => {
    if (terminalPromise) return terminalPromise;
    const cancelled = controller.signal.aborted;
    const failureModel =
      isProviderRuntimeFailure(error) && error.modelKey
        ? routeModels.find((model) => model.modelKey === error.modelKey) ?? currentFailureModel()
        : currentFailureModel();
    const publicError = cancelled
      ? {
          code: "REQUEST_CANCELLED" as const,
          message: "Run cancelled",
          retryable: false,
        }
      : isProviderRuntimeFailure(error)
        ? error.publicError
        : error instanceof McpRuntimeError
          ? {
              code: "TOOL_FAILED" as const,
              message: error.message,
              retryable: error.code === "MCP_PROVIDER_UNAVAILABLE",
              action: error.code === "MCP_PROVIDER_UNAVAILABLE"
                ? ("RETRY" as const)
                : error.code === "MCP_AUTH_REQUIRED"
                    || error.code === "MCP_AUTH_FAILED"
                    || error.code === "MCP_CONNECTION_REAUTH_REQUIRED"
                    || error.code === "MCP_CONFIGURATION_INVALID"
                  ? ("OPEN_SETTINGS" as const)
                  : undefined,
            }
          : error instanceof HttpError
            ? {
                code: error.code,
                message: error.message,
                retryable: error.retryable,
                action: error.action,
              }
            : {
                code: "INTERNAL" as const,
                message: "Agent chat failed unexpectedly",
                retryable: false,
              };
    terminalPromise = Promise.resolve()
      .then(async () => {
        const activeAttempt = attemptTracker.getActiveAttempt();
        if (activeAttempt && isProviderRuntimeFailure(error)) {
          await failRunAttempt({
            attemptId: activeAttempt.attemptId,
            failure: error,
            status: cancelled ? "CANCELLED" : undefined,
          }).catch((attemptError) => {
            console.error("[agent-chat] failed to settle active model attempt", {
              runId: run.runId,
              attemptId: activeAttempt.attemptId,
              error: safeErrorDetails(attemptError),
            });
          });
          attemptTracker.failAttempt(activeAttempt.attemptId);
        }
        if (isProviderRuntimeFailure(error) && error.credentialDisposition === "invalidate") {
          await markByokCredentialInvalid({
            appAccountId: access.appAccountId,
            model: failureModel,
            failure: error,
          }).catch((credentialError) => {
            console.error("[agent-chat] failed to mark BYOK credential invalid", {
              runId: run.runId,
              error: safeErrorDetails(credentialError),
            });
          });
        }
        await persistToolEventsReliably(
          run.runId,
          run.responseMessageId,
          toolEvents,
        );
        await settleReliably(
          run.runId,
          cancelled ? "CANCELLED" : "FAILED",
          {
            errorCode: publicError.code,
            errorMessage: publicError.message,
            errorJson: safeErrorDetails(error),
          },
        );
        await telemetry.trackRunFailed({
          runId: run.runId,
          threadId: run.conversationId,
          provider: failureModel.provider,
          model: failureModel.providerModelId,
          errorCode: publicError.code,
          durationMs: Date.now() - startedAt,
        });
      })
      .finally(cleanup);
    const details = { runId: run.runId, error: safeErrorDetails(error) };
    if (cancelled) console.info("[agent-chat] stream cancelled", details);
    else console.error("[agent-chat] stream failed", details);
    return terminalPromise;
  };
  // An explicit cancellation or a lost durable lease can abort the provider
  // before the AI SDK reaches its stream onEnd/onError callbacks. Settle
  // directly from the shared AbortController so every server-side abort releases
  // the one-active-run constraint and refunds any unused reservation.
  // settleFailure is idempotent through terminalPromise, so a later stream
  // callback safely joins the same terminal transaction.
  const onControllerAbort = () => {
    void settleFailure(controller.signal.reason ?? "run-aborted").catch(
      (settlementError) => {
        console.error("[agent-chat] failed to settle aborted stream", {
          runId: run.runId,
          error: safeErrorDetails(settlementError),
        });
      },
    );
  };
  if (controller.signal.aborted) onControllerAbort();
  else controller.signal.addEventListener("abort", onControllerAbort, { once: true });
  try {
    const effectiveModel = routingPlan.primaryModel;
    const context = await loadAgentChatContext(
      access.agentDbId,
      access.appAccountId,
      taskControlText,
      run.settingsRevisionId,
    );
    if (!context)
      throw new HttpError(
        404,
        "AGENT_NOT_FOUND",
        "Agent or settings revision not found",
      );
    const toolPolicy = getDefaultToolPolicy();
    const runtimeByModelKey = new Map<string, Promise<ProviderModelRuntime>>();
    const resolveRuntime = (model: AgentChatModelDefinition): Promise<ProviderModelRuntime> => {
      const existing = runtimeByModelKey.get(model.modelKey);
      if (existing) return existing;
      const pending = resolveAgentChatRuntime(model, {
        appAccountId: access.appAccountId,
      });
      runtimeByModelKey.set(model.modelKey, pending);
      return pending;
    };
    let providerToolModel = effectiveModel;
    let providerToolRuntime: ProviderModelRuntime | null = null;
    if (profile.requiresCurrentWeb) {
      const providerToolCandidates =
        effectiveModel.credentialSource === "byok" || effectiveModel.billingOwner === "user"
          ? routeModels.filter(
              (candidate) =>
                (candidate.credentialSource === "byok" || candidate.billingOwner === "user")
                && candidate.capabilities.webSearch
                && !failedCredentialProviders.has(credentialProviderId(candidate)),
            )
          : [effectiveModel];
      let firstProviderToolFailure: unknown;
      for (const candidate of providerToolCandidates) {
        if (failedCredentialProviders.has(credentialProviderId(candidate))) continue;
        currentFailureModelKey = candidate.modelKey;
        try {
          const candidateRuntime = await resolveRuntime(candidate);
          if (Object.keys(candidateRuntime.providerTools).length === 0) continue;
          providerToolModel = candidate;
          providerToolRuntime = candidateRuntime;
          currentFailureModelKey = candidate.modelKey;
          break;
        } catch (error) {
          firstProviderToolFailure ??= error;
          if (!isProviderRuntimeFailure(error) || !error.failoverEligible) throw error;
          failedPhysicalModelKeys.add(candidate.modelKey);
          if (error.credentialDisposition === "invalidate") {
            failedCredentialProviders.add(credentialProviderId(candidate));
            await persistCredentialInvalidation(candidate, error);
          }
        }
      }
      if (!providerToolRuntime) {
        if (firstProviderToolFailure) throw firstProviderToolFailure;
        throw new HttpError(
          503,
          "MODEL_UNAVAILABLE",
          "No compatible model runtime exposes the required provider web-search tool",
          true,
          "SELECT_MODEL",
        );
      }
    }

    // Provider-defined tools are wire-profile specific. If runtime preflight had
    // to advance to another user-owned provider/model to satisfy current-web
    // requirements, that physical model is also the logical primary for this
    // run's orchestration and token budget. This keeps prepareStep limits,
    // system capabilities, and the actual first invocation coherent.
    const executionModel = providerToolRuntime ? providerToolModel : effectiveModel;
    const isolatedSubagentTools =
      profile.complexity === "high" && executionModel.capabilities.tools
        ? buildIsolatedSubagentTools({
            delegate: (input) =>
              runIsolatedReadOnlySubagent({
                runId: run.runId,
                conversationId: run.conversationId,
                appAccountId: access.appAccountId,
                agentDbId: access.agentDbId,
                sequence: attemptTracker.nextSequence(),
                stepIndex,
                objective: input.objective,
                artifactIds: input.artifactIds,
                historyQuery: input.historyQuery,
                maxOutputTokens: input.maxOutputTokens,
                preferredModel: executionModel,
              }),
          })
        : {};

    toolRuntime = executionModel.capabilities.tools
      ? await buildAgentChatToolRuntime({
          agentDbId: access.agentDbId,
          appAccountId: access.appAccountId,
          userProfileId: access.userProfileId,
          policy: toolPolicy,
          runtime: { callCount: 0, timedOutCount: 0 },
          abortSignal: controller.signal,
          additionalTools: isolatedSubagentTools,
          eventLifecycle: {
            runId: run.runId,
            responseMessageId: run.responseMessageId,
            // ToolLoop and physical model-attempt steps are zero-based. Keep
            // execution lifecycle events on the same ordinal for correlation.
            getStepIndex: () => stepIndex,
            onStarted(event) {
              void telemetry.trackToolCall({
                runId: run.runId,
                toolName: event.toolName,
                stepIndex: event.stepIndex,
                state: "started",
                ...event.sourceMetadata,
              });
            },
            onFinished(event) {
              const state = event.state === "SUCCEEDED"
                ? "completed"
                : event.state === "TIMED_OUT"
                  ? "timed_out"
                  : event.state === "CANCELLED"
                    ? "cancelled"
                    : "failed";
              toolExecutionUi.set(event.toolCallId, {
                durationMs: event.durationMs,
                state,
              });
              void telemetry.trackToolCall({
                runId: run.runId,
                toolName: event.toolName,
                stepIndex: event.stepIndex,
                state,
                durationMs: event.durationMs,
                ...event.sourceMetadata,
              });
            },
            async projectOutput(event) {
              return projectToolResultForModel({
                conversationId: run.conversationId,
                runId: run.runId,
                responseMessageId: run.responseMessageId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                output: event.output,
                stateChanging: event.stateChanging,
                policy: event.policy,
                appAccountId: access.appAccountId,
                preferredControlModel: executionModel,
              });
            },
          },
        })
      : null;
    const tools: ToolSet = toolRuntime?.tools ?? {};
    const toolContext = buildAgentChatToolContext({
      agentDbId: access.agentDbId,
      appAccountId: access.appAccountId,
      userProfileId: access.userProfileId,
      runId: run.runId,
      allowPlatformSemanticRanking: canUsePlatformSemanticRanking(executionModel),
    });
    const installedSelectionCatalog = await buildSelectionMetadata();
    const providerTools = providerToolRuntime?.providerTools ?? {};
    const providerToolsActive = Object.keys(providerTools).length > 0;
    const activeProviderToolProfile = providerToolsActive
      ? providerToolModel.providerToolProfile
      : null;
    const providerId = providerToolModel.credentialProvider ?? providerToolModel.provider;
    const taskTools = providerToolsActive
      ? composeAgentTools({
          localTools: tools,
          providerTools,
          providerId,
        })
      : tools;
    const taskCatalog = buildRuntimeSelectionMetadata(
      taskTools,
      installedSelectionCatalog,
    );
    const discoveryTools = catalogEnumeration
      ? {}
      : buildRuntimeDiscoveryTools(taskCatalog);
    const runtimeTools: ToolSet = { ...taskTools, ...discoveryTools };
    const selectionCatalog = buildRuntimeSelectionMetadata(
      runtimeTools,
      installedSelectionCatalog,
    );
    const authoritativeToolDiscovery = catalogEnumeration
      ? inspectRuntimeToolCatalog(
          selectionCatalog,
          {},
          {
            forceInventory: true,
            includeRuntimeNames: /\b(?:runtime|internal|debug)\b/i.test(userText)
              || /\bexact\s+(?:tool\s+)?(?:names?|identifiers?|ids?)\b/i.test(userText),
          },
        )
      : undefined;
    // Keep the complete runtime available for execution/repair, but expose only
    // a bounded task-relevant schema set to the provider. AI SDK prepareStep
    // applies activeTools on every model step; catalog questions are answered
    // from the preloaded authoritative inventory without serializing 100+ tool
    // schemas into the prompt.
    const allTools: ToolSet = Object.fromEntries(
      Object.entries(runtimeTools).sort(([left], [right]) => left.localeCompare(right)),
    );
    const allToolNames = Object.keys(allTools);
    const schemaTokenCosts = await estimateToolSchemaTokenCosts(allTools);
    const baseReservedToolTokens = TOOL_REQUEST_ENVELOPE_TOKENS;
    const initialPhase = profile.requiresTools ? "DISCOVERY" : "SYNTHESIS";
    const initialOutputTokens = getAgentStepOutputTokenLimit(
      executionModel,
      profile,
      initialPhase,
    );
    const initialSchemaBudget = toolSchemaSelectionBudgetTokens({
      model: executionModel,
      outputTokens: initialOutputTokens,
      baseReservedToolTokens,
    });
    const webToolNames = allToolNames.filter((name) =>
      isWebSearchRuntimeTool(name, allTools),
    );
    const semanticToolScores = await rankToolCatalogSemantically({
      profile,
      userText: taskControlText,
      catalog: selectionCatalog,
      availableToolNames: allToolNames,
      webToolNames,
      catalogEnumeration,
      allowPlatformSemanticRanking: canUsePlatformSemanticRanking(executionModel),
    });
    const initialActiveToolNames = selectActiveToolNames({
      profile,
      phase: initialPhase,
      userText: taskControlText,
      catalog: selectionCatalog,
      availableToolNames: allToolNames,
      webToolNames,
      catalogEnumeration,
      inventoryPreloaded: authoritativeToolDiscovery !== undefined,
      semanticScores: semanticToolScores,
      schemaTokenCosts,
      maxSchemaTokens: initialSchemaBudget,
    });
    const runtimeToolSchemaTokens = sumToolSchemaTokenCosts(
      initialActiveToolNames,
      schemaTokenCosts,
    );
    const runtimeReservedToolTokens =
      baseReservedToolTokens + runtimeToolSchemaTokens;
    const runtimeRoutingRequirements = {
      ...routingPlan.requirements,
      reservedToolTokens: runtimeReservedToolTokens,
    };
    const modelPromptCapabilities = {
      tools: executionModel.capabilities.tools,
      webSearch: executionModel.capabilities.webSearch,
      images: executionModel.capabilities.images,
    };
    const baseInstructions = buildSystemPrompt(
      context,
      modelPromptCapabilities,
      body.uiMode === "terminal" ? "terminal" : "chat",
    );
    const dynamicContextSections = buildDynamicAgentContextSections(
      context,
      modelPromptCapabilities,
      {
        taskText: taskControlText,
        domains: profile.domains,
        stateChangingIntent: profile.stateChangingIntent,
      },
    );
    const capabilityMap = buildCapabilityMap(selectionCatalog, {
      deferredThreshold: MAX_ACTIVE_TOOL_COUNT,
    });
    const capabilityFocus = buildCapabilityFocus(selectionCatalog, {
      preferredToolNames: initialActiveToolNames,
      semanticScores: semanticToolScores,
    });
    const boundTools = bindAgentChatToolContext(allTools, toolContext);
    const orchestrationState = createAgentOrchestrationState({
      modelKey: executionModel.modelKey,
      modelId: executionModel.providerModelId,
      initialInputTokens: routingPlan.requirements.estimatedInputTokens,
      reservedOutputTokens: routingPlan.requirements.reservedOutputTokens,
      reservedToolTokens: runtimeReservedToolTokens,
    });

    const orchestrationRoutingPlan = providerToolsActive
      ? {
          ...routingPlan,
          requirements: runtimeRoutingRequirements,
          primaryModel: executionModel,
          // A provider-defined tool can only survive a model switch when both
          // models declare the same concrete provider-tool wire profile.
          // Existing platform providers such as OpenRouter predate that profile
          // taxonomy and deliberately use "none"; keep them pinned while their
          // provider tool is installed rather than passing a foreign provider
          // tool through an unrelated fallback model.
          fallbackModels: activeProviderToolProfile === "none"
            ? []
            : routeModels.filter(
                (model) =>
                  model.modelKey !== executionModel.modelKey
                  && model.providerToolProfile === activeProviderToolProfile,
              ),
        }
      : {
          ...routingPlan,
          requirements: runtimeRoutingRequirements,
        };

    const physicalDefinitionsFor = (
      preferred: AgentChatModelDefinition,
    ): AgentChatModelDefinition[] => {
      if (preferred.credentialSource !== "byok" && preferred.billingOwner !== "user") {
        return [preferred];
      }
      const currentRequirements = {
        ...orchestrationRoutingPlan.requirements,
        reservedToolTokens: orchestrationState.reservedToolTokens,
      };
      const compatible = routeModels.filter((candidate) => {
        const userOwned =
          candidate.credentialSource === "byok" || candidate.billingOwner === "user";
        if (
          !userOwned
          || failedPhysicalModelKeys.has(candidate.modelKey)
          || failedCredentialProviders.has(credentialProviderId(candidate))
        ) return false;
        if (activeProviderToolProfile && candidate.providerToolProfile !== activeProviderToolProfile) {
          return false;
        }
        return modelSatisfiesRoutingRequirements(
          candidate,
          currentRequirements,
          orchestrationState.currentInputTokens,
        );
      });
      // Rank every compatible physical transport relative to the model that
      // owns the current prompt prefix. Exact physical-model aliases remain
      // ahead of same-provider alternatives, and provider/adapter/tool-profile
      // affinity is exhausted before crossing a cache boundary.
      return rankModelsByCacheAffinity(compatible, preferred);
    };

    const stepModelCache = new Map<string, Promise<ReturnType<typeof createByokFailoverLanguageModel>>>();
    const resolveStepLanguageModel = (args: {
      model: AgentChatModelDefinition;
      stepNumber: number;
      reason: "INITIAL" | "TOOL_LOOP" | "ESCALATION";
    }) => {
      const key = `${args.stepNumber}:${args.model.modelKey}:${args.reason}`;
      const existing = stepModelCache.get(key);
      if (existing) return existing;
      const pending = (async () => {
        const candidates: Array<{
          definition: AgentChatModelDefinition;
          model: LanguageModel;
        }> = [];
        let firstResolutionError: unknown;
        let consumedStepAttemptIndices = 0;
        const physicalDefinitions = physicalDefinitionsFor(args.model);
        for (let candidateIndex = 0; candidateIndex < physicalDefinitions.length; candidateIndex += 1) {
          const definition = physicalDefinitions[candidateIndex]!;
          // Runtime resolution can fail before the AI SDK makes a provider
          // request (for example an invalid/missing BYOK credential). A failure
          // of the preferred physical candidate is user-visible failover and is
          // therefore persisted as an attempt. Secondary candidates are
          // pre-resolved eagerly; their failure is not a failover unless the
          // preferred candidate later fails, so do not create false attempt
          // history for those speculative checks.
          currentFailureModelKey = definition.modelKey;
          try {
            const runtime = await resolveRuntime(definition);
            candidates.push({ definition, model: runtime.languageModel });
          } catch (error) {
            firstResolutionError ??= error;
            if (!isProviderRuntimeFailure(error)) throw error;
            if (candidateIndex === 0) {
              const reason = args.reason;
              const sequence = attemptTracker.nextSequence();
              const row = await beginRunAttempt({
                runId: run.runId,
                sequence,
                stepIndex: args.stepNumber,
                stepAttemptIndex: consumedStepAttemptIndices,
                reason,
                model: definition,
                sdkCallId: `${run.runId}:${sequence}:resolution`,
                sdkProvider: definition.provider,
                sdkModelId: definition.providerModelId,
              });
              consumedStepAttemptIndices += 1;
              telemetry.trackModelAttemptStarted({
                runId: run.runId,
                sequence,
                provider: definition.provider,
                model: definition.providerModelId,
                modelKey: definition.modelKey,
                reason,
              });
              await failRunAttempt({ attemptId: row.id, failure: error });
              telemetry.trackModelAttemptFailed({
                runId: run.runId,
                sequence,
                provider: definition.provider,
                model: definition.providerModelId,
                modelKey: definition.modelKey,
                reason,
                failureKind: error.kind,
                failoverEligible: error.failoverEligible,
                credentialDisposition: error.credentialDisposition,
              });
              lastFailedModelByStep.set(args.stepNumber, definition.modelKey);
            }
            if (!error.failoverEligible) throw error;
            failedPhysicalModelKeys.add(definition.modelKey);
            if (error.credentialDisposition === "invalidate") {
              failedCredentialProviders.add(credentialProviderId(definition));
              await persistCredentialInvalidation(definition, error);
            }
          }
        }
        if (candidates.length === 0) {
          if (firstResolutionError) throw firstResolutionError;
          throw new HttpError(
            503,
            "MODEL_UNAVAILABLE",
            "No compatible user-owned provider model is currently available",
            true,
            "SELECT_MODEL",
          );
        }
        return createByokFailoverLanguageModel({
          stepIndex: args.stepNumber,
          candidates,
          initialReason: consumedStepAttemptIndices > 0 ? "FAILOVER" : args.reason,
          initialStepAttemptIndex: consumedStepAttemptIndices,
          async onAttemptStarted(event) {
            const sequence = attemptTracker.nextSequence();
            const row = await beginRunAttempt({
              runId: run.runId,
              sequence,
              stepIndex: event.stepIndex,
              stepAttemptIndex: event.stepAttemptIndex,
              reason: event.reason,
              model: event.model,
              sdkCallId: `${run.runId}:${sequence}`,
              sdkProvider: event.model.provider,
              sdkModelId: event.model.providerModelId,
            });
            currentFailureModelKey = event.model.modelKey;
            attemptTracker.setActiveAttempt({
              attemptId: row.id,
              sequence,
              stepIndex: event.stepIndex,
              stepAttemptIndex: event.stepAttemptIndex,
              model: event.model,
            });
            attemptReasonById.set(row.id, event.reason);
            telemetry.trackModelAttemptStarted({
              runId: run.runId,
              sequence,
              provider: event.model.provider,
              model: event.model.providerModelId,
              modelKey: event.model.modelKey,
              reason: event.reason,
            });
            return { attemptId: row.id };
          },
          async onAttemptFailed(event) {
            const tracked = attemptTracker.getActiveAttempt();
            if (event.failure.failoverEligible) {
              failedPhysicalModelKeys.add(event.model.modelKey);
            }
            await failRunAttempt({
              attemptId: event.attemptId,
              failure: event.failure,
            });
            if (tracked?.attemptId === event.attemptId) {
              lastFailedModelByStep.set(tracked.stepIndex, event.model.modelKey);
              telemetry.trackModelAttemptFailed({
                runId: run.runId,
                sequence: tracked.sequence,
                provider: event.model.provider,
                model: event.model.providerModelId,
                modelKey: event.model.modelKey,
                reason: attemptReasonById.get(event.attemptId),
                failureKind: event.failure.kind,
                failoverEligible: event.failure.failoverEligible,
                credentialDisposition: event.failure.credentialDisposition,
              });
            }
            attemptReasonById.delete(event.attemptId);
            if (event.failure.credentialDisposition === "invalidate") {
              failedCredentialProviders.add(credentialProviderId(event.model));
              await persistCredentialInvalidation(event.model, event.failure);
            }
            attemptTracker.failAttempt(event.attemptId);
            if (tracked?.attemptId === event.attemptId) {
              currentFailureModelKey = event.model.modelKey;
            }
          },
          onCandidateCommitted(event) {
            const active = attemptTracker.getActiveAttempt();
            if (!active || active.attemptId !== event.attemptId) return;
            const failedModel = lastFailedModelByStep.get(active.stepIndex);
            if (failedModel && failedModel !== event.model.modelKey) {
              physicalFailoverUsed = true;
              telemetry.trackModelFailover({
                runId: run.runId,
                sequence: active.sequence,
                provider: event.model.provider,
                model: event.model.providerModelId,
                fromModel: failedModel,
                toModel: event.model.modelKey,
                reason: attemptReasonById.get(event.attemptId) ?? "FAILOVER",
              });
              lastFailedModelByStep.delete(active.stepIndex);
            }
            currentFailureModelKey = event.model.modelKey;
            orchestrationState.currentModelKey = event.model.modelKey;
            orchestrationState.currentModelId = event.model.providerModelId;
            attemptTracker.setCommittedAttempt(args.stepNumber, active);
          },
        });
      })();
      stepModelCache.set(key, pending);
      return pending;
    };

    const prepareStep = createAgentPrepareStep({
      tools: allTools,
      profile,
      catalog: selectionCatalog,
      routingPlan: orchestrationRoutingPlan,
      availableModels: routeModels,
      state: orchestrationState,
      baseInstructions,
      dynamicContextInstructions: dynamicContextSections.requestContext,
      durableMemoryInstructions: dynamicContextSections.durableMemory,
      mcpInstructions: toolRuntime?.mcpInstructions ?? [],
      capabilityMap,
      capabilityFocus,
      externalizeToolResult: async (event) => projectToolResultForModel({
        conversationId: run.conversationId,
        runId: run.runId,
        responseMessageId: run.responseMessageId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: event.output,
        stateChanging: event.stateChanging,
        policy: event.policy,
        appAccountId: access.appAccountId,
        preferredControlModel: executionModel,
      }),
      userText: taskControlText,
      appAccountId: access.appAccountId,
      cacheNamespace: `agent-chat:${access.agentDbId}`,
      authoritativeToolDiscovery,
      semanticToolScores,
      schemaTokenCosts,
      baseReservedToolTokens,
      resolveLanguageModel: resolveStepLanguageModel,
      supportsStatefulContinuation(model) {
        // Stateful continuation is only safe when this logical step has one
        // physical transport candidate; otherwise a failover would no longer
        // have the canonical preceding prompt that previousResponseId replaces.
        return physicalDefinitionsFor(model).length === 1;
      },
      onModelSelected(selection) {
        currentFailureModelKey = selection.model.modelKey;
      },
      onStepPrepared(event) {
        const webSearchActive = event.activeTools.some((name) =>
          isWebSearchRuntimeTool(name, allTools),
        );
        emitStepPrepared({
          runId: run.runId,
          step: event.stepNumber,
          phase: event.phase,
          activeToolCount: event.activeTools.length,
          catalogToolCount: event.catalogToolCount,
          catalogQuery: event.catalogEnumeration,
          inventoryPreloaded: event.inventoryPreloaded,
          explicitToolChoiceSupported: event.explicitToolChoiceSupported,
          toolChoiceMode: event.toolChoiceMode,
          webSearchActive,
        });
        emitToolsSelected({
          runId: run.runId,
          step: event.stepNumber,
          phase: event.phase,
          activeToolCount: event.activeTools.length,
          catalogToolCount: event.catalogToolCount,
          catalogQuery: event.catalogEnumeration,
          inventoryPreloaded: event.inventoryPreloaded,
          explicitToolChoiceSupported: event.explicitToolChoiceSupported,
          toolChoiceMode: event.toolChoiceMode,
          webSearchActive,
        });
      },
    });
    const repairToolCall = createRepairToolCall({
      tools: allTools,
      state: orchestrationState,
      maxAttempts: toolPolicy.toolRepairMaxAttempts,
      onTelemetry: () => undefined,
    });
    const initialStepModel = await resolveStepLanguageModel({
      model: executionModel,
      stepNumber: 0,
      reason: "INITIAL",
    });
    const agent = new ToolLoopAgent({
      model: initialStepModel,
      instructions: baseInstructions,
      // Conversation compaction injects bounded working-state/context-summary
      // messages as system-role history. AI SDK 7 rejects system messages in
      // ToolLoopAgent message input unless this native compatibility switch is
      // explicit; the stable runtime instructions remain separate above.
      allowSystemInMessages: true,
      tools: boundTools,
      toolApproval: ({ toolCall }) => {
        const runtimeTool = allTools[toolCall.toolName];
        const metadata = getMcpToolMetadata(runtimeTool);
        if (metadata) {
          const executionSource = metadata.resolveExecutionSource?.(toolCall.input);
          if (
            mcpRiskRequiresApproval(
              executionSource?.effectiveRisk
                ?? metadata.effectiveRisk
                ?? (metadata.stateChanging ? "UNKNOWN" : "READ_ONLY"),
              executionSource?.approvalMode ?? metadata.approvalMode,
            )
          ) return "user-approval";
        }
        // An MCP proposal can reach a signer/broadcaster only through a native
        // tool. Require a separate approval over that exact native input; the
        // earlier MCP approval never becomes wallet authority.
        if (getToolEffect(runtimeTool)?.stateChanging === true) return "user-approval";
        return undefined;
      },
      prepareStep,
      repairToolCall,
      maxRetries:
        executionModel.credentialSource === "byok" || executionModel.billingOwner === "user"
          ? 0
          : toolPolicy.modelMaxRetries,
      stopWhen: [isStepCount(toolPolicy.maxToolSteps), stopOnMcpInputRequired],
      maxOutputTokens: Math.min(
        executionModel.maxOutputTokens,
        executionModel.providerMaxOutputTokens,
      ),
      async onStepEnd(event) {
        const tracked = attemptTracker.getCommittedAttempt(event.stepNumber);
        if (!tracked) return;
        await completeRunAttempt({
          attemptId: tracked.attemptId,
          result: event,
          model: tracked.model,
        });
        const completedAttempt = attemptTracker.completeCommittedAttempt(event.stepNumber);
        if (completedAttempt) attemptReasonById.delete(completedAttempt.attemptId);
        telemetry.trackModelAttemptCompleted({
          runId: run.runId,
          sequence: tracked.sequence,
          provider: tracked.model.provider,
        });
      },
    });
    const history = await loadConversationHistory(
      run.conversationId,
      {
        ...(body.kind === "message" && body.triggerKind === "REGENERATE"
          ? { throughMessageId: run.triggerMessageId }
          : {}),
        relevanceQuery: taskControlText,
        allowPlatformSemanticRanking: canUsePlatformSemanticRanking(executionModel),
      },
    );
    if (history.historyWindowed) {
      // The DB loader intentionally omitted exact older rows before prepareStep
      // receives the working set. Treat that as a relevance-condensed context
      // boundary so the lossless history reader is materialized immediately,
      // even if the later in-memory compiler does not need to drop another turn.
      orchestrationState.contextReductionLevel = Math.max(
        orchestrationState.contextReductionLevel,
        4,
      );
    }
    if (history.virtualizedAttachmentCount > 0) {
      orchestrationState.virtualizedAttachmentCount = Math.max(
        orchestrationState.virtualizedAttachmentCount,
        history.virtualizedAttachmentCount,
      );
    }
    if (history.virtualizedTextPartCount > 0) {
      // Exact text is now behind canonical history rehydration, so expose the
      // history reader and prevent provider-owned continuation state from
      // resurrecting the omitted payload.
      orchestrationState.contextReductionLevel = Math.max(
        orchestrationState.contextReductionLevel,
        4,
      );
    }
    const agentStream = await createAgentUIStream({
      agent,
      uiMessages: history.messages,
      sendReasoning: false,
      generateMessageId: () => run.responseMessageId,
      abortSignal: controller.signal,
      timeout: { totalMs: 120_000 },
      messageMetadata: ({ part }) => {
        if (
          (part.type === "text-start" || part.type === "text-delta") &&
          !firstTokenAt
        ) {
          firstTokenAt = new Date();
          telemetry.trackFirstToken({
            runId: run.runId,
            provider: currentFailureModel().provider,
            durationMs: firstTokenAt.getTime() - startedAt,
          });
        }
        return {
          runId: run.runId,
          modelKey: orchestrationState.currentModelKey,
          requestedModelKey: routingPlan.requestedModel.modelKey,
          fallbackUsed: physicalFailoverUsed,
          createdAt: new Date(startedAt).toISOString(),
          ...(part.type === "finish"
            ? { completedAt: new Date().toISOString() }
            : {}),
        };
      },
      onStepEnd: ({ toolCalls, toolResults }) => {
        const completedStepIndex = stepIndex;
        for (let index = 0; index < toolCalls.length; index += 1) {
          const call = toolCalls[index] as {
            toolCallId?: string;
            toolName?: string;
            input?: unknown;
          };
          const hasResult = index < toolResults.length;
          const result = hasResult ? (toolResults[index] as unknown) : undefined;
          const resultOutput =
            result && typeof result === "object" && "output" in result
              ? (result as { output?: unknown }).output
              : result;
          const runtimeTool = call.toolName ? allTools[call.toolName] : undefined;
          const mcp = getMcpToolMetadata(runtimeTool);
          const mcpExecutionSource = mcp?.resolveExecutionSource?.(call.input);
          const runtimeMetadata = getAgentRuntimeToolMetadata(runtimeTool);
          const event: ToolEvent = {
            toolCallId: call.toolCallId ?? `${run.runId}:${completedStepIndex}:${index}`,
            toolName: call.toolName ?? "unknown",
            state: hasResult
              ? toolEventStateForResult(result) === "SUCCEEDED"
                ? "SUCCEEDED"
                : "FAILED"
              : "PENDING",
            inputJson: toolPolicy.redactInputForTools.includes(
              call.toolName ?? "",
            )
              ? { redacted: true }
              : call.input,
            outputJson: resultOutput,
            stepIndex: completedStepIndex,
            ...(mcp
              ? {
                  toolSource: "mcp",
                  sourceConnectionId:
                    mcpExecutionSource?.connectionId
                    ?? (mcp.connectionId === "runtime" ? undefined : mcp.connectionId),
                  sourceToolName:
                    mcpExecutionSource?.externalToolName ?? mcp.externalToolName,
                  sourceDisplayName:
                    mcpExecutionSource?.serverName ?? mcp.serverName,
                }
              : runtimeMetadata?.source === "provider"
                ? {
                    toolSource: "provider",
                    sourceToolName: call.toolName ?? "unknown",
                    sourceDisplayName: runtimeMetadata.providerId,
                  }
                : {}),
          };
          toolEvents.push(event);
          // Tools with an execute closure emit start/terminal telemetry from the
          // execution lifecycle itself. Provider-defined tools have no local
          // execute closure, so retain this step-end observability fallback.
          if (!runtimeTool || typeof runtimeTool !== "object" || !("execute" in runtimeTool) || typeof runtimeTool.execute !== "function") {
            void telemetry.trackToolCall({
              runId: run.runId,
              toolName: call.toolName ?? "unknown",
              stepIndex: completedStepIndex,
              state: !hasResult
                ? "started"
                : (toolEventStateForResult(result) === "SUCCEEDED" ? "completed" : "failed"),
            });
          }
        }
        stepIndex = completedStepIndex + 1;
      },
      onEnd: async ({ finishReason, responseMessage, isAborted }) => {
        if (terminalPromise) return terminalPromise;
        const outcome =
          isAborted || controller.signal.aborted ? "CANCELLED" : "COMPLETED";
        terminalPromise = (async () => {
          for (const event of toolEvents) {
            if (event.state === "PENDING" || event.outputJson === undefined) continue;
            const runtimeTool = allTools[event.toolName];
            const declaredStateChanging = getToolEffect(runtimeTool)?.stateChanging;
            const stateChanging = declaredStateChanging ?? false;
            const policy = resolveToolContextPolicy({
              toolName: event.toolName,
              tool: runtimeTool,
              stateChanging: declaredStateChanging,
            });
            try {
              const projected = await projectToolResultForModel({
                conversationId: run.conversationId,
                runId: run.runId,
                responseMessageId: run.responseMessageId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                output: event.outputJson,
                stateChanging,
                policy,
                appAccountId: access.appAccountId,
                preferredControlModel: executionModel,
              });
              event.outputJson = projected.persistenceOutput ?? projected.modelOutput;
              event.resultArtifactId = projected.artifactId;
            } catch (projectionError) {
              console.warn("[agent-chat] failed to persist final tool artifact", {
                runId: run.runId,
                toolCallId: event.toolCallId,
                error: safeErrorDetails(projectionError),
              });
            }
          }
          const persistedResponseParts = projectToolOutputsForPersistence(
            responseMessage.parts,
            new Map(
              toolEvents.flatMap((event) =>
                event.outputJson !== undefined
                  ? [[event.toolCallId, event.outputJson] as const]
                  : [],
              ),
            ),
          );
          await persistToolEventsReliably(
            run.runId,
            run.responseMessageId,
            toolEvents,
          );
          const settled = await settleReliably(run.runId, outcome, {
            firstTokenAt,
            ...(outcome === "COMPLETED"
              ? {
                  responseMessage: {
                    id: run.responseMessageId,
                    parts: persistedResponseParts,
                    metadata: responseMessage.metadata,
                  },
                }
              : {}),
            finishReason,
            ...(outcome === "CANCELLED"
              ? {
                  errorCode: "REQUEST_CANCELLED",
                  errorMessage: "Run cancelled",
                }
              : {}),
          });
          if (outcome === "COMPLETED") {
            const completed = await prisma.agentChatRun.findUnique({
              where: { id: run.runId },
              select: {
                finalProvider: true,
                finalProviderModelId: true,
                inputTokens: true,
                outputTokens: true,
                totalTokens: true,
                providerCostUsdMicros: true,
              },
            });
            await telemetry.trackRunCompleted({
              runId: run.runId,
              threadId: run.conversationId,
              provider: completed?.finalProvider ?? effectiveModel.provider,
              model:
                completed?.finalProviderModelId ??
                effectiveModel.providerModelId,
              durationMs: Date.now() - startedAt,
              tokenUsage: {
                inputTokens: completed?.inputTokens ?? 0,
                outputTokens: completed?.outputTokens ?? 0,
                totalTokens: completed?.totalTokens ?? 0,
              },
              chargeCents: settled.finalChargeCents,
              providerCostUsdMicros:
                completed?.providerCostUsdMicros?.toString(),
            });
          }
        })().finally(cleanup);
        return terminalPromise;
      },
      onError(error) {
        void settleFailure(error).catch((settlementError) => {
          console.error("[agent-chat] failed to settle provider error", {
            runId: run.runId,
            error: safeErrorDetails(settlementError),
          });
        });
        if (controller.signal.aborted) {
          return JSON.stringify({
            error: { code: "REQUEST_CANCELLED", message: "The response was cancelled.", retryable: false },
          });
        }
        if (isProviderRuntimeFailure(error)) {
          return JSON.stringify({ error: error.publicError });
        }
        if (error instanceof McpRuntimeError) {
          return JSON.stringify({
            error: {
              code: "TOOL_FAILED",
              message: error.message,
              retryable: error.code === "MCP_PROVIDER_UNAVAILABLE",
              ...(error.code === "MCP_PROVIDER_UNAVAILABLE"
                ? { action: "RETRY" }
                : error.code === "MCP_AUTH_REQUIRED"
                    || error.code === "MCP_AUTH_FAILED"
                    || error.code === "MCP_CONNECTION_REAUTH_REQUIRED"
                    || error.code === "MCP_CONFIGURATION_INVALID"
                  ? { action: "OPEN_SETTINGS" }
                  : {}),
            },
          });
        }
        if (error instanceof HttpError) {
          return JSON.stringify({
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              ...(error.action ? { action: error.action } : {}),
            },
          });
        }
        return JSON.stringify({
          error: { code: "INTERNAL", message: "Agent chat failed unexpectedly.", retryable: false },
        });
      },
    });
    type AgentChatChunk = InferUIMessageChunk<AgentChatUIMessage>;
    const streamWithMcpWarnings = (
      agentStream as ReadableStream<AgentChatChunk>
    ).pipeThrough(new TransformStream<AgentChatChunk, AgentChatChunk>({
      transform(chunk, transformController) {
        const toolCallId = "toolCallId" in chunk && typeof chunk.toolCallId === "string"
          ? chunk.toolCallId
          : null;
        const execution = toolCallId ? toolExecutionUi.get(toolCallId) : undefined;
        const enriched = execution && "toolMetadata" in chunk
          ? {
              ...chunk,
              toolMetadata: {
                ...(chunk.toolMetadata ?? {}),
                execution: {
                  durationMs: execution.durationMs,
                  state: execution.state,
                },
              },
            } as AgentChatChunk
          : chunk;
        transformController.enqueue(enriched);
        if (chunk.type !== "start") return;
        for (const warning of toolRuntime?.mcpWarnings ?? []) {
          transformController.enqueue({
            type: "data-notice",
            id: `mcp-warning:${warning.connectionId}:${warning.code}`,
            data: {
              level: "warning",
              code: warning.code,
              message: warning.message,
            },
          });
        }
      },
    }));
    // Independently drain the SSE tee so persistence and cleanup complete even
    // if the browser disconnects or stops applying backpressure.
    return createUIMessageStreamResponse({
      stream: streamWithMcpWarnings,
      consumeSseStream: consumeStream,
    });
  } catch (error) {
    await settleFailure(error);
    if (error instanceof HttpError) throw error;
    if (error instanceof McpRuntimeError) {
      const unavailable = error.code === "MCP_PROVIDER_UNAVAILABLE";
      const requiresConfiguration =
        error.code === "MCP_AUTH_REQUIRED"
        || error.code === "MCP_AUTH_FAILED"
        || error.code === "MCP_CONNECTION_REAUTH_REQUIRED"
        || error.code === "MCP_CONFIGURATION_INVALID";
      throw new HttpError(
        unavailable ? 503 : 502,
        "TOOL_FAILED",
        error.message,
        unavailable,
        unavailable ? "RETRY" : requiresConfiguration ? "OPEN_SETTINGS" : undefined,
      );
    }
    if (isProviderRuntimeFailure(error)) {
      const publicError = error.publicError;
      const status = publicError.code === "PROVIDER_AUTH_FAILED"
        ? 401
        : publicError.code === "PROVIDER_PERMISSION_DENIED"
          ? 403
          : publicError.code === "PROVIDER_BILLING_FAILED"
            ? 402
            : publicError.code === "PROVIDER_RATE_LIMITED"
                || publicError.code === "PROVIDER_QUOTA_EXHAUSTED"
              ? 429
              : publicError.code === "PROVIDER_REQUEST_INVALID"
                  || publicError.code === "INVALID_MODEL"
                  || publicError.code === "MODEL_CAPABILITY_MISMATCH"
                ? 400
                : publicError.code === "PROVIDER_MODEL_NOT_FOUND"
                  ? 404
                  : 503;
      throw new HttpError(
        status,
        publicError.code,
        publicError.message,
        publicError.retryable,
        publicError.action,
      );
    }
    throw new HttpError(
      500,
      "INTERNAL",
      "Agent chat failed unexpectedly",
      false,
    );
  }
}
