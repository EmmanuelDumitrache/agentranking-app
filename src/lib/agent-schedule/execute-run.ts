import "server-only";
import {
  isStepCount,
  ToolLoopAgent,
  type LanguageModel,
  type ToolSet,
} from "ai";
import { prisma } from "@/lib/db";
import { resolveAgentChatRuntime } from "@/lib/llm-provider/agent-chat-model";
import type { ProviderModelRuntime } from "@/lib/llm-provider/credentials/provider-adapter";
import { createByokFailoverLanguageModel } from "@/lib/llm-provider/failover-language-model";
import { getAgentChatAccessForWorker } from "@/lib/agent-schedule/access";
import { computeNextRunAt, isOnceCronExpr } from "@/lib/agent-schedule/cron";
import { loadAgentChatContext } from "@/features/agent-chat/server/agent-context";
import {
  buildCapabilityFocus,
  buildCapabilityMap,
  buildDynamicAgentContextSections,
  buildSystemPrompt,
} from "@/features/agent-chat/server/prompts";
import { getModelOrThrow } from "@/features/agent-chat/server/model-registry";
import {
  buildAgentRoutingPlan,
  modelSatisfiesRoutingRequirements,
  rankModelsByCacheAffinity,
} from "@/features/agent-chat/server/orchestration/routing";
import {
  isToolCatalogQuery,
  profileAgentTask,
} from "@/features/agent-chat/server/orchestration/task-profile";
import {
  createAgentOrchestrationState,
  createAgentPrepareStep,
  getAgentStepOutputTokenLimit,
} from "@/features/agent-chat/server/orchestration/prepare-step";
import {
  MAX_ACTIVE_TOOL_COUNT,
  rankToolCatalogSemantically,
  selectActiveToolNames,
} from "@/features/agent-chat/server/orchestration/tool-selection";
import { estimateRunInputTokenDemand, startRun } from "@/features/agent-chat/server/run/start-run";
import { createConversation } from "@/features/agent-chat/server/repositories/conversations";
import { settleRun } from "@/features/agent-chat/server/run/settle-run";
import {
  buildAgentChatToolRuntime,
  getDefaultToolPolicy,
  type AgentChatToolRuntime,
} from "@/features/agent-chat/server/tools";
import {
  bindAgentChatToolContext,
  buildAgentChatToolContext,
} from "@/features/agent-chat/server/tools/context";
import { HttpError } from "@/features/agent-chat/server/http-error";
import type { AgentChatUIMessage } from "@/features/agent-chat/shared/ui-message";
import { isProviderRuntimeFailure } from "@/lib/llm-provider/provider-failure";
import { markByokCredentialInvalid } from "@/lib/llm-provider/credentials/service";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import type { AgentChatModelDefinition } from "@/features/agent-chat/shared/model-registry-types";
import { stopOnMcpInputRequired } from "@/features/agent-chat/server/mcp/runtime-manager";
import {
  composeAgentTools,
  getAgentRuntimeToolMetadata,
  isWebSearchRuntimeTool,
} from "@/features/agent-chat/server/tools/provider-tools";
import {
  buildRuntimeSelectionMetadata,
  buildSelectionMetadata,
} from "@/features/agent-chat/server/tools/selection-metadata";
import { buildRuntimeDiscoveryTools } from "@/features/agent-chat/server/tools/runtime-discovery-tools";
import { inspectRuntimeToolCatalog } from "@/features/agent-chat/server/tools/runtime-tool-discovery-core";
import { createRepairToolCall } from "@/features/agent-chat/server/tools/repair-tool-call";
import { buildIsolatedSubagentTools } from "@/features/agent-chat/server/tools/subagent-tools";
import { runIsolatedReadOnlySubagent } from "@/features/agent-chat/server/run/isolated-subagent";
import { projectToolResultForModel } from "@/features/agent-chat/server/repositories/tool-result-artifacts";
import {
  beginToolEvent,
  finishToolEvent,
  toolEventStateForResult,
} from "@/features/agent-chat/server/repositories/tool-events";
import { resolveToolContextPolicy } from "@/features/agent-chat/server/tools/tool-context-policy";
import { getToolEffect } from "@/features/agent-chat/server/tools/tool-effects";
import { AgentRunAttemptTracker } from "@/features/agent-chat/server/run/attempt-tracker";
import {
  beginRunAttempt,
  completeRunAttempt,
  failRunAttempt,
} from "@/features/agent-chat/server/repositories/attempts";
import {
  estimatePreRunToolReserveTokens,
  estimateToolSchemaTokenCosts,
  sumToolSchemaTokenCosts,
  TOOL_REQUEST_ENVELOPE_TOKENS,
} from "@/features/agent-chat/server/run/token-budget";
import { toolSchemaSelectionBudgetTokens } from "@/features/agent-chat/server/run/context-budget";
import { canUsePlatformSemanticRanking } from "@/features/agent-chat/server/control-plane-model";

const SCHEDULE_SYSTEM_PREFIX =
  "You are running on a scheduled automation for the agent owner. Be concise and actionable. Complete the task in this single run.";

export type ExecuteScheduleRunResult =
  | {
      ok: true;
      runId: string;
      conversationId: string;
      outputSummary: string;
      costCents: number;
    }
  | {
      ok: false;
      reason: string;
      errorMessage?: string;
    };

export async function executeAgentScheduleById(
  scheduleId: string,
  scheduledFor: Date,
  options: { allowPaused?: boolean } = {},
): Promise<ExecuteScheduleRunResult> {
  const schedule = await prisma.agentSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!schedule) {
    return { ok: false, reason: "schedule_not_found" };
  }
  if (schedule.status === "completed") {
    return { ok: false, reason: "schedule_completed" };
  }
  if (schedule.status !== "active" && !options.allowPaused) {
    return { ok: false, reason: "schedule_paused" };
  }

  const access = await getAgentChatAccessForWorker(
    schedule.appAccountId,
    schedule.agentDbId,
  );
  if (!access) {
    return { ok: false, reason: "agent_access_denied" };
  }

  if (schedule.type === "trade") {
    await finalizeSkippedRun(
      schedule.id,
      scheduledFor,
      schedule.modelKey,
      "Scheduled trading is not enabled yet — coming when agent trading ships.",
    );
    return {
      ok: false,
      reason: "trade_not_enabled",
      errorMessage: "Scheduled trading is not enabled yet.",
    };
  }

  const runRecord = await prisma.agentScheduleRun.upsert({
    where: {
      scheduleId_scheduledFor: {
        scheduleId: schedule.id,
        scheduledFor,
      },
    },
    create: {
      scheduleId: schedule.id,
      scheduledFor,
      status: "pending",
      modelKey: schedule.modelKey,
    },
    update: {},
  });

  if (runRecord.status === "success") {
    return {
      ok: true,
      runId: runRecord.runId ?? "",
      conversationId: runRecord.conversationId ?? "",
      outputSummary: runRecord.outputSummary ?? "",
      costCents: runRecord.costCents ?? 0,
    };
  }
  if (runRecord.status === "skipped") {
    return {
      ok: false,
      reason: "already_skipped",
      errorMessage: runRecord.skipReason ?? undefined,
    };
  }

  const leaseOwner = crypto.randomUUID();
  const leaseStartedAt = new Date();
  const leaseExpiresAt = new Date(leaseStartedAt.getTime() + 5 * 60_000);
  const legacyStaleBefore = new Date(leaseStartedAt.getTime() - 5 * 60_000);
  const claimed = await prisma.agentScheduleRun.updateMany({
    where: {
      id: runRecord.id,
      status: { notIn: ["success", "skipped"] },
      OR: [
        { status: { not: "running" } },
        { leaseExpiresAt: { lt: leaseStartedAt } },
        { leaseOwner: null, startedAt: { lt: legacyStaleBefore } },
      ],
    },
    data: {
      status: "running",
      leaseOwner,
      leaseExpiresAt,
      startedAt: leaseStartedAt,
      completedAt: null,
      modelKey: schedule.modelKey,
      errorMessage: null,
      skipReason: null,
      attempt: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    const terminal = await prisma.agentScheduleRun.findUnique({
      where: { id: runRecord.id },
      select: {
        status: true,
        runId: true,
        conversationId: true,
        outputSummary: true,
        costCents: true,
        skipReason: true,
      },
    });
    if (terminal?.status === "success") {
      return {
        ok: true,
        runId: terminal.runId ?? "",
        conversationId: terminal.conversationId ?? "",
        outputSummary: terminal.outputSummary ?? "",
        costCents: terminal.costCents ?? 0,
      };
    }
    if (terminal?.status === "skipped") {
      return { ok: false, reason: "already_skipped", errorMessage: terminal.skipReason ?? undefined };
    }
    return { ok: false, reason: "already_running" };
  }

  let startedRunId: string | null = null;
  let scheduleConversationId: string | null = null;
  let failureModel: AgentChatModelDefinition | null = null;
  let toolRuntime: AgentChatToolRuntime | null = null;
  const attemptTracker = new AgentRunAttemptTracker();

  try {
    const model = await getModelOrThrow(schedule.modelKey, { appAccountId: access.appAccountId });
    failureModel = model;
    const requiresPlatformCredits =
      model.credentialSource !== "byok"
      && (model.pricing.inputUsdMicrosPerMillion > 0
        || model.pricing.outputUsdMicrosPerMillion > 0);
    if (requiresPlatformCredits && access.balanceCents <= 0) {
      await finalizeSkippedRun(
        schedule.id,
        scheduledFor,
        schedule.modelKey,
        "Insufficient LLM credits for paid model.",
        runRecord.id,
        leaseOwner,
      );
      return {
        ok: false,
        reason: "insufficient_credits",
        errorMessage: "Insufficient LLM credits for the selected paid model.",
      };
    }

    const promptText =
      schedule.type === "report"
        ? `${schedule.promptText}\n\nFormat as a short market report with bullet highlights.`
        : schedule.promptText;

    const message: AgentChatUIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: promptText }],
    };

    const profile = profileAgentTask({ text: promptText, parts: message.parts });
    const catalogEnumeration = profile.catalogQuery || isToolCatalogQuery(promptText);
    const conversation = await createConversation(access, {
      modelKey: schedule.modelKey,
      titleSeed: promptText,
    });
    scheduleConversationId = conversation.id;
    const estimatedInputTokens = await estimateRunInputTokenDemand(
      access,
      message,
      conversation.id,
      { additionalSystemPromptChars: SCHEDULE_SYSTEM_PREFIX.length },
    );
    const initialRoutingPhase = profile.requiresTools ? "DISCOVERY" : "SYNTHESIS";
    const routingPlan = await buildAgentRoutingPlan({
      requestedModelKey: schedule.modelKey,
      profile,
      appAccountId: access.appAccountId,
      estimatedInputTokens,
      reservedOutputTokens: getAgentStepOutputTokenLimit(
        model,
        profile,
        initialRoutingPhase,
      ),
      reservedToolTokens: estimatePreRunToolReserveTokens(profile.requiresTools),
    });

    // A failed/expired schedule lease may be retried for the same scheduled
    // occurrence. Give each claimed attempt its own chat-run idempotency key so
    // an earlier settled/abandoned run cannot block the retry.
    const requestId = `schedule:${schedule.id}:${scheduledFor.toISOString()}:attempt:${runRecord.attempt + 1}`;
    const started = await startRun(
      access,
      routingPlan,
      message,
      requestId,
      conversation.id,
      {
        estimatedInputTokens,
        triggerKind: "SCHEDULE",
        additionalModelCalls:
          profile.complexity === "high" && routingPlan.primaryModel.capabilities.tools ? 1 : 0,
      },
    );
    startedRunId = started.runId;
    const routeModels = [routingPlan.primaryModel, ...routingPlan.fallbackModels];
    const failedPhysicalModelKeys = new Set<string>();
    const failedCredentialProviders = new Set<string>();
    const credentialProviderId = (candidate: AgentChatModelDefinition) =>
      candidate.credentialProvider ?? candidate.provider;
    const isUserOwned = (candidate: AgentChatModelDefinition) =>
      candidate.credentialSource === "byok" || candidate.billingOwner === "user";
    const runtimeByModelKey = new Map<string, Promise<ProviderModelRuntime>>();
    const resolveRuntime = (candidate: AgentChatModelDefinition): Promise<ProviderModelRuntime> => {
      const existing = runtimeByModelKey.get(candidate.modelKey);
      if (existing) return existing;
      const pending = resolveAgentChatRuntime(candidate, {
        appAccountId: access.appAccountId,
      });
      runtimeByModelKey.set(candidate.modelKey, pending);
      return pending;
    };

    let executionModel = routingPlan.primaryModel;
    let providerToolRuntime: ProviderModelRuntime | null = null;
    if (profile.requiresCurrentWeb) {
      const providerToolCandidates = isUserOwned(executionModel)
        ? routeModels.filter((candidate) =>
            isUserOwned(candidate)
            && candidate.capabilities.webSearch
            && !failedCredentialProviders.has(credentialProviderId(candidate)))
        : [executionModel];
      let firstProviderToolFailure: unknown;
      for (const candidate of providerToolCandidates) {
        failureModel = candidate;
        try {
          const candidateRuntime = await resolveRuntime(candidate);
          if (Object.keys(candidateRuntime.providerTools).length === 0) continue;
          executionModel = candidate;
          providerToolRuntime = candidateRuntime;
          break;
        } catch (error) {
          firstProviderToolFailure ??= error;
          if (!isProviderRuntimeFailure(error) || !error.failoverEligible || !isUserOwned(candidate)) {
            throw error;
          }
          failedPhysicalModelKeys.add(candidate.modelKey);
          if (error.credentialDisposition === "invalidate") {
            failedCredentialProviders.add(credentialProviderId(candidate));
            await markByokCredentialInvalid({
              appAccountId: access.appAccountId,
              model: candidate,
              failure: error,
            }).catch((credentialError) => {
              console.warn("[agent-schedule] failed to persist BYOK credential invalidation", {
                scheduleId: schedule.id,
                provider: credentialProviderId(candidate),
                error: safeErrorDetails(credentialError),
              });
            });
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
    failureModel = executionModel;

    await prisma.agentChatRun.update({
      where: { id: started.runId },
      data: { status: "STREAMING" },
    });

    const context = await loadAgentChatContext(
      access.agentDbId,
      access.appAccountId,
      promptText,
      started.settingsRevisionId,
    );
    if (!context) {
      throw new HttpError(404, "AGENT_NOT_FOUND", "Agent context not found");
    }

    const toolPolicy = getDefaultToolPolicy();
    let currentStepIndex = 0;
    const isolatedSubagentTools =
      profile.complexity === "high" && executionModel.capabilities.tools
        ? buildIsolatedSubagentTools({
            delegate: (input) =>
              runIsolatedReadOnlySubagent({
                runId: started.runId,
                conversationId: started.conversationId,
                appAccountId: access.appAccountId,
                agentDbId: access.agentDbId,
                sequence: attemptTracker.nextSequence(),
                stepIndex: currentStepIndex,
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
          additionalTools: isolatedSubagentTools,
          eventLifecycle: {
            runId: started.runId,
            responseMessageId: started.responseMessageId,
            getStepIndex: () => currentStepIndex,
            async projectOutput(event) {
              return projectToolResultForModel({
                conversationId: started.conversationId,
                runId: started.runId,
                responseMessageId: started.responseMessageId,
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
    const localTools: ToolSet = toolRuntime?.tools ?? {};
    const providerTools = providerToolRuntime?.providerTools ?? {};
    const providerToolsActive = Object.keys(providerTools).length > 0;
    const activeProviderToolProfile = providerToolsActive
      ? executionModel.providerToolProfile
      : null;
    const providerId = executionModel.credentialProvider ?? executionModel.provider;
    const taskTools = providerToolsActive
      ? composeAgentTools({
          localTools,
          providerTools,
          providerId,
        })
      : localTools;
    const installedSelectionCatalog = await buildSelectionMetadata();
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
            includeRuntimeNames: /\b(?:runtime|internal|debug)\b/i.test(promptText)
              || /\bexact\s+(?:tool\s+)?(?:names?|identifiers?|ids?)\b/i.test(promptText),
          },
        )
      : undefined;
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
      userText: promptText,
      catalog: selectionCatalog,
      availableToolNames: allToolNames,
      webToolNames,
      catalogEnumeration,
      allowPlatformSemanticRanking: canUsePlatformSemanticRanking(executionModel),
    });
    const initialActiveToolNames = selectActiveToolNames({
      profile,
      phase: initialPhase,
      userText: promptText,
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
    const toolContext = buildAgentChatToolContext({
      agentDbId: access.agentDbId,
      appAccountId: access.appAccountId,
      userProfileId: access.userProfileId,
      runId: started.runId,
      allowPlatformSemanticRanking: canUsePlatformSemanticRanking(executionModel),
    });
    const modelPromptCapabilities = {
      tools: executionModel.capabilities.tools,
      webSearch: executionModel.capabilities.webSearch,
      images: executionModel.capabilities.images,
    };
    const baseInstructions = `${SCHEDULE_SYSTEM_PREFIX}\n\n${buildSystemPrompt(
      context,
      modelPromptCapabilities,
      "chat",
    )}`;
    const dynamicContextSections = buildDynamicAgentContextSections(
      context,
      modelPromptCapabilities,
      {
        taskText: promptText,
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
          fallbackModels: activeProviderToolProfile === "none"
            ? []
            : routeModels.filter(
                (candidate) =>
                  candidate.modelKey !== executionModel.modelKey
                  && candidate.providerToolProfile === activeProviderToolProfile,
              ),
        }
      : {
          ...routingPlan,
          requirements: runtimeRoutingRequirements,
        };
    const physicalDefinitionsFor = (
      preferred: AgentChatModelDefinition,
    ): AgentChatModelDefinition[] => {
      if (!isUserOwned(preferred)) return [preferred];
      const currentRequirements = {
        ...orchestrationRoutingPlan.requirements,
        reservedToolTokens: orchestrationState.reservedToolTokens,
      };
      const compatible = routeModels.filter((candidate) => {
        if (
          !isUserOwned(candidate)
          || failedPhysicalModelKeys.has(candidate.modelKey)
          || failedCredentialProviders.has(credentialProviderId(candidate))
        ) {
          return false;
        }
        if (
          activeProviderToolProfile
          && candidate.providerToolProfile !== activeProviderToolProfile
        ) {
          return false;
        }
        return modelSatisfiesRoutingRequirements(
          candidate,
          currentRequirements,
          orchestrationState.currentInputTokens,
        );
      });
      return rankModelsByCacheAffinity(compatible, preferred);
    };

    const stepModelCache = new Map<string, Promise<LanguageModel>>();
    const resolveStepLanguageModel = (args: {
      model: AgentChatModelDefinition;
      stepNumber: number;
      reason: "INITIAL" | "TOOL_LOOP" | "ESCALATION";
    }): Promise<LanguageModel> => {
      const key = `${args.stepNumber}:${args.model.modelKey}:${args.reason}`;
      const existing = stepModelCache.get(key);
      if (existing) return existing;
      const pending = (async () => {
        const candidates: Array<{
          definition: AgentChatModelDefinition;
          model: LanguageModel;
        }> = [];
        let firstResolutionError: unknown;
        for (const definition of physicalDefinitionsFor(args.model)) {
          failureModel = definition;
          try {
            const runtime = await resolveRuntime(definition);
            candidates.push({
              definition,
              model: runtime.languageModel,
            });
          } catch (error) {
            firstResolutionError ??= error;
            if (!isProviderRuntimeFailure(error) || !error.failoverEligible) throw error;
            failedPhysicalModelKeys.add(definition.modelKey);
            if (error.credentialDisposition === "invalidate") {
              failedCredentialProviders.add(credentialProviderId(definition));
              await markByokCredentialInvalid({
                appAccountId: access.appAccountId,
                model: definition,
                failure: error,
              }).catch((credentialError) => {
                console.warn("[agent-schedule] failed to persist BYOK credential invalidation", {
                  scheduleId: schedule.id,
                  provider: credentialProviderId(definition),
                  error: safeErrorDetails(credentialError),
                });
              });
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
          initialReason: args.reason,
          async onAttemptStarted(event) {
            const sequence = attemptTracker.nextSequence();
            const row = await beginRunAttempt({
              runId: started.runId,
              sequence,
              stepIndex: event.stepIndex,
              stepAttemptIndex: event.stepAttemptIndex,
              reason: event.reason,
              model: event.model,
              sdkCallId: `${started.runId}:${sequence}`,
              sdkProvider: event.model.provider,
              sdkModelId: event.model.providerModelId,
            });
            attemptTracker.setActiveAttempt({
              attemptId: row.id,
              sequence,
              stepIndex: event.stepIndex,
              stepAttemptIndex: event.stepAttemptIndex,
              model: event.model,
            });
            failureModel = event.model;
            return { attemptId: row.id };
          },
          async onAttemptFailed(event) {
            if (event.failure.failoverEligible) {
              failedPhysicalModelKeys.add(event.model.modelKey);
            }
            await failRunAttempt({
              attemptId: event.attemptId,
              failure: event.failure,
            });
            if (event.failure.credentialDisposition === "invalidate") {
              failedCredentialProviders.add(credentialProviderId(event.model));
              await markByokCredentialInvalid({
                appAccountId: access.appAccountId,
                model: event.model,
                failure: event.failure,
              }).catch((credentialError) => {
                console.warn("[agent-schedule] failed to persist BYOK credential invalidation", {
                  scheduleId: schedule.id,
                  provider: credentialProviderId(event.model),
                  error: safeErrorDetails(credentialError),
                });
              });
            }
            attemptTracker.failAttempt(event.attemptId);
            failureModel = event.model;
          },
          onCandidateCommitted(event) {
            const active = attemptTracker.getActiveAttempt();
            if (!active || active.attemptId !== event.attemptId) return;
            failureModel = event.model;
            orchestrationState.currentModelKey = event.model.modelKey;
            orchestrationState.currentModelId = event.model.providerModelId;
            attemptTracker.setCommittedAttempt(args.stepNumber, active);
          },
        });
      })();
      stepModelCache.set(key, pending);
      return pending;
    };

    const sharedPrepareStep = createAgentPrepareStep({
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
        conversationId: started.conversationId,
        runId: started.runId,
        responseMessageId: started.responseMessageId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: event.output,
        stateChanging: event.stateChanging,
        policy: event.policy,
        appAccountId: access.appAccountId,
        preferredControlModel: executionModel,
      }),
      userText: promptText,
      appAccountId: access.appAccountId,
      cacheNamespace: `agent-schedule:${access.agentDbId}`,
      authoritativeToolDiscovery,
      semanticToolScores,
      schemaTokenCosts,
      baseReservedToolTokens,
      resolveLanguageModel: resolveStepLanguageModel,
      supportsStatefulContinuation(candidate) {
        return physicalDefinitionsFor(candidate).length === 1;
      },
      onModelSelected(selection) {
        failureModel = selection.model;
      },
    });
    const prepareStep = (args: Parameters<typeof sharedPrepareStep>[0]) => {
      currentStepIndex = args.stepNumber;
      return sharedPrepareStep(args);
    };
    const repairToolCall = createRepairToolCall({
      tools: allTools,
      state: orchestrationState,
      maxAttempts: toolPolicy.toolRepairMaxAttempts,
      onTelemetry: () => undefined,
    });
    const initialModel = await resolveStepLanguageModel({
      model: executionModel,
      stepNumber: 0,
      reason: "INITIAL",
    });

    const agent = new ToolLoopAgent({
      model: initialModel,
      instructions: baseInstructions,
      tools: boundTools,
      prepareStep,
      repairToolCall,
      maxRetries: isUserOwned(executionModel) ? 0 : toolPolicy.modelMaxRetries,
      stopWhen: [isStepCount(toolPolicy.maxToolSteps), stopOnMcpInputRequired],
      maxOutputTokens: Math.min(
        executionModel.maxOutputTokens,
        executionModel.providerMaxOutputTokens,
      ),
      async onStepEnd(event) {
        const tracked = attemptTracker.getCommittedAttempt(event.stepNumber);
        if (tracked) {
          await completeRunAttempt({
            attemptId: tracked.attemptId,
            result: event,
            model: tracked.model,
          });
          attemptTracker.completeCommittedAttempt(event.stepNumber);
        }

        // Local/MCP tools persist their lifecycle from the execute wrapper.
        // Provider-defined tools have no local execute closure, so persist and
        // artifact-back their observations here as the schedule equivalent of
        // the interactive stream's step-end recovery path.
        const toolCalls = event.toolCalls ?? [];
        const toolResults = event.toolResults ?? [];
        for (let index = 0; index < toolCalls.length; index += 1) {
          const call = toolCalls[index] as {
            toolCallId?: string;
            toolName?: string;
            input?: unknown;
          };
          const toolName = call.toolName ?? "unknown";
          const runtimeTool = allTools[toolName];
          if (
            runtimeTool
            && typeof runtimeTool === "object"
            && "execute" in runtimeTool
            && typeof runtimeTool.execute === "function"
          ) {
            continue;
          }

          const toolCallId = call.toolCallId
            ?? `${started.runId}:${event.stepNumber}:${index}`;
          const runtimeMetadata = getAgentRuntimeToolMetadata(runtimeTool);
          const sourceMetadata = runtimeMetadata?.source === "provider"
            ? {
                toolSource: "provider",
                sourceToolName: toolName,
                sourceDisplayName: runtimeMetadata.providerId,
              }
            : undefined;
          await beginToolEvent({
            runId: started.runId,
            responseMessageId: started.responseMessageId,
            stepIndex: event.stepNumber,
            toolCallId,
            toolName,
            input: call.input,
            redactInput: toolPolicy.redactInputForTools.includes(toolName),
            sourceMetadata,
          }).catch((persistenceError) => {
            console.warn("[agent-schedule] failed to persist provider tool start", {
              scheduleId: schedule.id,
              toolCallId,
              error: safeErrorDetails(persistenceError),
            });
          });

          if (index >= toolResults.length) continue;
          const result = toolResults[index] as unknown;
          const resultOutput =
            result && typeof result === "object" && "output" in result
              ? (result as { output?: unknown }).output
              : result;
          const declaredStateChanging = getToolEffect(runtimeTool)?.stateChanging;
          const stateChanging = declaredStateChanging ?? false;
          const policy = resolveToolContextPolicy({
            toolName,
            tool: runtimeTool,
            stateChanging: declaredStateChanging,
          });
          let modelOutput = resultOutput;
          let persistenceOutput = resultOutput;
          let resultArtifactId: string | undefined;
          let externalized = false;
          try {
            const projected = await projectToolResultForModel({
              conversationId: started.conversationId,
              runId: started.runId,
              responseMessageId: started.responseMessageId,
              toolCallId,
              toolName,
              output: resultOutput,
              stateChanging,
              policy,
              appAccountId: access.appAccountId,
              preferredControlModel: executionModel,
            });
            modelOutput = projected.modelOutput;
            persistenceOutput = projected.persistenceOutput ?? projected.modelOutput;
            resultArtifactId = projected.artifactId;
            externalized = projected.externalized;
          } catch (projectionError) {
            console.warn("[agent-schedule] failed to persist provider tool artifact", {
              scheduleId: schedule.id,
              toolCallId,
              error: safeErrorDetails(projectionError),
            });
          }
          await finishToolEvent({
            runId: started.runId,
            toolCallId,
            toolName,
            state: toolEventStateForResult(result),
            output: persistenceOutput,
            summary: externalized ? modelOutput : undefined,
            resultArtifactId,
          }).catch((persistenceError) => {
            console.warn("[agent-schedule] failed to persist provider tool completion", {
              scheduleId: schedule.id,
              toolCallId,
              error: safeErrorDetails(persistenceError),
            });
          });
        }
      },
    });

    const result = await agent.generate({
      messages: [
        {
          role: "user",
          content: promptText,
        },
      ],
      timeout: { totalMs: 120_000 },
    });
    if (stopOnMcpInputRequired({ steps: result.steps })) {
      throw new HttpError(
        409,
        "TOOL_FAILED",
        "A scheduled MCP operation requires interactive user input. Open the agent chat and run the operation interactively.",
        false,
      );
    }

    const contentText = result.text.trim();
    const now = new Date().toISOString();
    const settled = await settleRun(started.runId, "COMPLETED", {
      responseMessage: {
        id: started.responseMessageId,
        parts: [{ type: "text", text: contentText }],
        metadata: {
          runId: started.runId,
          modelKey: orchestrationState.currentModelKey,
          requestedModelKey: schedule.modelKey,
          createdAt: now,
          completedAt: now,
        },
      },
      finishReason: result.finishReason,
      firstTokenAt: new Date(),
    });

    const summary =
      contentText.length > 500 ? `${contentText.slice(0, 497)}…` : contentText;

    const isOnce = isOnceCronExpr(schedule.cronExpr);

    await prisma.$transaction(async (tx) => {
      const finalized = await tx.agentScheduleRun.updateMany({
        where: { id: runRecord.id, leaseOwner },
        data: {
          status: "success",
          completedAt: new Date(),
          outputSummary: summary,
          costCents: settled.finalChargeCents,
          conversationId: started.conversationId,
          runId: started.runId,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (finalized.count !== 1) {
        throw new Error("Schedule run lease was lost before finalization");
      }
      await tx.agentSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          ...(isOnce
            ? { status: "completed", nextRunAt: scheduledFor }
            : { nextRunAt: computeNextRunAt(schedule.cronExpr) }),
        },
      });
      // Scheduled executions get durable transcript/run provenance, but they do
      // not occupy the user's limited set of active interactive chat threads.
      await tx.agentChatConversation.update({
        where: { id: started.conversationId },
        data: { status: "ARCHIVED" },
      });
    });

    return {
      ok: true,
      runId: started.runId,
      conversationId: started.conversationId,
      outputSummary: summary,
      costCents: settled.finalChargeCents,
    };
  } catch (error) {
    const activeAttempt = attemptTracker.getActiveAttempt();
    if (activeAttempt && isProviderRuntimeFailure(error)) {
      await failRunAttempt({
        attemptId: activeAttempt.attemptId,
        failure: error,
      }).catch((attemptError) => {
        console.error("[agent-schedule] failed to settle active model attempt", {
          scheduleId: schedule.id,
          attemptId: activeAttempt.attemptId,
          error: safeErrorDetails(attemptError),
        });
      });
      attemptTracker.failAttempt(activeAttempt.attemptId);
    }
    const classified =
      error instanceof HttpError
        ? {
            code: error.code,
            message: error.message,
            failure: null,
          }
        : isProviderRuntimeFailure(error)
          ? {
              code: error.publicError.code,
              message: error.publicError.message,
              failure: error,
            }
          : {
              code: "INTERNAL" as const,
              message: "Schedule run failed",
              failure: null,
            };
    const errorMessage = classified.message;

    if (
      classified.failure?.credentialDisposition === "invalidate" &&
      failureModel
    ) {
      await markByokCredentialInvalid({
        appAccountId: access.appAccountId,
        model: failureModel,
        failure: classified.failure,
      }).catch((credentialError) => {
        console.error("[agent-schedule] failed to mark BYOK credential invalid", {
          scheduleId: schedule.id,
          error: safeErrorDetails(credentialError),
        });
      });
    }

    if (startedRunId) {
      await settleRun(startedRunId, "FAILED", {
        errorCode: classified.code,
        errorMessage,
        errorJson: safeErrorDetails(error),
      }).catch((settlementError) => {
        console.error("[agent-schedule] failed to settle chat run", {
          scheduleId: schedule.id,
          runId: startedRunId,
          error: safeErrorDetails(settlementError),
        });
      });
    }

    if (scheduleConversationId) {
      await prisma.agentChatConversation.updateMany({
        where: {
          id: scheduleConversationId,
          appAccountId: access.appAccountId,
          agentDbId: access.agentDbId,
        },
        data: { status: "DELETED", deletedAt: new Date() },
      }).catch((conversationError) => {
        console.warn("[agent-schedule] failed to retire failed schedule conversation", {
          scheduleId: schedule.id,
          conversationId: scheduleConversationId,
          error: safeErrorDetails(conversationError),
        });
      });
    }

    console.error("[agent-schedule] execution failed", {
      scheduleId: schedule.id,
      error: safeErrorDetails(error),
    });

    const isOnce = isOnceCronExpr(schedule.cronExpr);

    const failed = await prisma.agentScheduleRun.updateMany({
      where: { id: runRecord.id, leaseOwner },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage,
        ...(scheduleConversationId ? { conversationId: scheduleConversationId } : {}),
        ...(startedRunId ? { runId: startedRunId } : {}),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    if (failed.count === 1) await prisma.agentSchedule.update({
      where: { id: schedule.id },
      data: {
        ...(isOnce
          ? { nextRunAt: scheduledFor }
          : { nextRunAt: computeNextRunAt(schedule.cronExpr) }),
      },
    });

    return { ok: false, reason: "execution_failed", errorMessage };
  } finally {
    await toolRuntime?.close().catch((error) => {
      console.warn("[agent-schedule] failed to close tool runtime", {
        scheduleId: schedule.id,
        error: safeErrorDetails(error),
      });
    });
    await prisma.agentScheduleRun.updateMany({
      where: { id: runRecord.id, leaseOwner },
      data: { leaseOwner: null, leaseExpiresAt: null },
    }).catch(() => undefined);
  }
}

async function finalizeSkippedRun(
  scheduleId: string,
  scheduledFor: Date,
  modelKey: string,
  skipReason: string,
  existingRunId?: string,
  leaseOwner?: string,
): Promise<void> {
  const schedule = await prisma.agentSchedule.findUnique({
    where: { id: scheduleId },
    select: { cronExpr: true },
  });

  await prisma.$transaction(async (tx) => {
    if (existingRunId) {
      const finalized = await tx.agentScheduleRun.updateMany({
        where: {
          id: existingRunId,
          ...(leaseOwner ? { leaseOwner } : {}),
        },
        data: {
          status: "skipped",
          skipReason,
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (finalized.count !== 1) {
        throw new Error("Schedule run lease was lost before skip finalization");
      }
    } else {
      await tx.agentScheduleRun.upsert({
        where: {
          scheduleId_scheduledFor: { scheduleId, scheduledFor },
        },
        create: {
          scheduleId,
          scheduledFor,
          status: "skipped",
          modelKey,
          skipReason,
          completedAt: new Date(),
        },
        update: {
          status: "skipped",
          skipReason,
          completedAt: new Date(),
        },
      });
    }

    const terminalAt = new Date();
    const oneShot = schedule ? isOnceCronExpr(schedule.cronExpr) : false;
    await tx.agentSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: terminalAt,
        ...(oneShot
          ? { status: "completed", nextRunAt: scheduledFor }
          : { nextRunAt: schedule ? computeNextRunAt(schedule.cronExpr, terminalAt) : undefined }),
      },
    });
  });
}

export async function runScheduleNow(
  agentDbId: number,
  scheduleId: string,
): Promise<ExecuteScheduleRunResult> {
  const schedule = await prisma.agentSchedule.findFirst({
    where: { id: scheduleId, agentDbId },
  });
  if (!schedule) {
    return { ok: false, reason: "schedule_not_found" };
  }
  return executeAgentScheduleById(schedule.id, new Date(), { allowPaused: true });
}
