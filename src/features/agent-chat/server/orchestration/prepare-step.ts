import "server-only";
import {
  pruneMessages,
  type LanguageModel,
  type ModelMessage,
  type PrepareStepFunction,
  type StepResult,
  type ToolSet,
  type TypedToolResult,
} from "ai";
import { resolveAgentChatLanguageModel } from "@/lib/llm-provider/agent-chat-model";
import { supportsExplicitToolChoice } from "@/lib/llm-provider/opencode-request-normalization";
import type {
  AgentTaskProfile,
  AgentStepPhase,
  AgentOrchestrationState,
  AgentRoutingPlan,
  ToolSelectionEntry,
} from "./types";
import { getEscalationModel, modelSatisfiesRoutingRequirements } from "./routing";
import { isToolCatalogQuery } from "./task-profile";
import type { RuntimeToolDiscoveryResult } from "../tools/runtime-tool-discovery-contract";
import {
  boundMcpPromptInstructions,
  buildActiveDomainGuidance,
  composeAgentStepInstructionRegions,
  selectMcpPromptInstructions,
  type McpPromptInstruction,
} from "../prompts";
import {
  computeModelInputLimit,
  estimateModelMessagesTokens,
  estimateTextTokens,
  sumToolSchemaTokenCosts,
} from "../run/token-budget";
import {
  compileAgentContext,
  contextNeedsToolResultRehydration,
  type ContextCompilerExternalizer,
} from "../run/context-compiler";
import {
  allocateContextComponentBudgets,
  boundContextText,
  toolSchemaSelectionBudgetTokens,
} from "../run/context-budget";
import { normalizeToolOutcome } from "./tool-outcome";
import { isWebSearchRuntimeTool } from "../tools/provider-tools";
import { HttpError } from "../http-error";
import { selectActiveToolNames } from "./tool-selection";
import { buildReasoningProviderOptions } from "./reasoning-control";
import { buildProviderContextManagementOptions } from "./provider-context-management";
import { getToolEffect } from "../tools/tool-effects";
import {
  isContextRetrievalToolName,
  toolAppearsStateChanging,
  toolResultAppearsError,
} from "../tools/tool-context-policy";
import { projectOpenAiStatefulContinuation } from "./stateful-continuation";
import { canUsePlatformSemanticRanking } from "../control-plane-model";
import {
  applyIncrementalPromptCaching,
  buildCacheAwareSystemInstructions,
  buildPromptCacheProviderOptions,
  mergeModelProviderOptions,
} from "./prompt-cache";
type AgentPrepareStepResult = NonNullable<
  Awaited<ReturnType<PrepareStepFunction<ToolSet>>>
>;

const STATEFUL_CONTINUATION_MAX_CONTEXT_UTILIZATION = 0.72;

function providerProtectedToolNamesInContext(
  messages: readonly ModelMessage[],
  tools: ToolSet,
): string[] {
  const names = new Set<string>();
  for (const message of messages) {
    const content = (message as unknown as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const rawPart of content) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as {
        type?: unknown;
        toolName?: unknown;
        output?: unknown;
      };
      if (typeof part.toolName !== "string" || part.toolName.length === 0) continue;
      const stateChanging = toolAppearsStateChanging({
        toolName: part.toolName,
        tool: tools[part.toolName],
      });
      if (part.type === "tool-call") {
        if (stateChanging) names.add(part.toolName);
        continue;
      }
      if (part.type !== "tool-result") continue;
      if (stateChanging || toolResultAppearsError(part.output)) {
        names.add(part.toolName);
      }
    }
  }
  return [...names].sort();
}

function hasPersistedCompactionContext(messages: readonly ModelMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "system") return false;
    const content = (message as unknown as { content?: unknown }).content;
    if (typeof content !== "string") return false;
    const trimmed = content.trimStart();
    return trimmed.startsWith("Conversation context summary from earlier messages.")
      || trimmed.startsWith("Conversation history working-set marker.");
  });
}

export function getAgentStepOutputTokenLimit(
  model: AgentRoutingPlan["primaryModel"],
  profile: AgentTaskProfile,
  phase: AgentStepPhase,
): number {
  const maximum = Math.max(1, Math.min(model.maxOutputTokens, model.providerMaxOutputTokens));
  if (phase === "SYNTHESIS") return maximum;
  if (phase === "EXECUTION" && (profile.stateChangingIntent || profile.complexity === "high")) {
    return Math.min(maximum, 6_144);
  }
  return Math.min(maximum, 4_096);
}

// ── Factory ──
export function createAgentPrepareStep(params: {
  tools: ToolSet;
  profile: AgentTaskProfile;
  catalog: readonly ToolSelectionEntry[];
  routingPlan: AgentRoutingPlan;
  /** Physical model definitions that may be committed by runtime failover. */
  availableModels?: readonly AgentRoutingPlan["primaryModel"][];
  state: AgentOrchestrationState;
  baseInstructions: string;
  dynamicContextInstructions?: string;
  durableMemoryInstructions?: string;
  mcpInstructions?: readonly McpPromptInstruction[];
  capabilityMap?: string;
  capabilityFocus?: string;
  externalizeToolResult?: ContextCompilerExternalizer;
  userText: string;
  appAccountId: string;
  cacheNamespace?: string;
  authoritativeToolDiscovery?: RuntimeToolDiscoveryResult;
  semanticToolScores?: ReadonlyMap<string, number>;
  schemaTokenCosts: ReadonlyMap<string, number>;
  /** Reservation that excludes concrete tool schemas; schemas are added per step. */
  baseReservedToolTokens?: number;
  resolveLanguageModel?: (args: {
    model: AgentRoutingPlan["primaryModel"];
    stepNumber: number;
    reason: "INITIAL" | "TOOL_LOOP" | "ESCALATION";
  }) => Promise<LanguageModel>;
  supportsStatefulContinuation?: (
    model: AgentRoutingPlan["primaryModel"],
  ) => boolean;
  onModelSelected?: (selection: {
    stepNumber: number;
    model: AgentRoutingPlan["primaryModel"];
    reason: "INITIAL" | "TOOL_LOOP" | "ESCALATION";
  }) => void | Promise<void>;
  onStepPrepared?: (event: {
    stepNumber: number;
    phase: AgentStepPhase;
    activeTools: readonly string[];
    catalogToolCount: number;
    catalogEnumeration: boolean;
    inventoryPreloaded: boolean;
    explicitToolChoiceSupported: boolean;
    toolChoiceMode: "auto" | "required";
  }) => void | Promise<void>;
}): PrepareStepFunction<ToolSet> {
  const catalogEnumeration =
    params.profile.catalogQuery || isToolCatalogQuery(params.userText);
  if (params.authoritativeToolDiscovery?.mode === "inventory") {
    params.state.runtimeToolInventoryListed = true;
  }
  return async (args) => {
    const stepNumber = args.stepNumber;
    updateProgressState(params.state, args.steps, stepNumber, params.tools);
    const contextMessages = pruneMessages({
      messages: args.messages,
      reasoning: "all",
      emptyMessages: "remove",
    });
    params.state.currentInputTokens = Math.max(
      1,
      estimateModelMessagesTokens(contextMessages),
    );
    if (hasPersistedCompactionContext(contextMessages)) {
      params.state.contextReductionLevel = Math.max(
        params.state.contextReductionLevel,
        4,
      );
    }
    if (contextNeedsToolResultRehydration(contextMessages, params.tools)) {
      params.state.externalizedToolResultCount = Math.max(
        1,
        params.state.externalizedToolResultCount,
      );
    }
    const phase = detectPhase({
      stepNumber,
      state: params.state,
      profile: params.profile,
      catalogEnumeration,
      tools: params.tools,
    });
    const availableToolNames = Object.keys(params.tools).sort();
    const webToolNames = availableToolNames.filter((name) =>
      isWebSearchRuntimeTool(name, params.tools),
    );
    const currentPhysicalModel = [
      params.routingPlan.primaryModel,
      ...params.routingPlan.fallbackModels,
      ...(params.availableModels ?? []),
    ].find((model) => model.modelKey === params.state.currentModelKey);
    let selectedModel = currentPhysicalModel ?? params.routingPlan.primaryModel;
    const baseReservedToolTokens = Math.max(
      0,
      params.baseReservedToolTokens ?? params.routingPlan.requirements.reservedToolTokens,
    );
    const provisionalOutputTokens = getAgentStepOutputTokenLimit(
      selectedModel,
      params.profile,
      phase,
    );
    const activeTools = selectActiveToolNames({
      profile: params.profile,
      phase,
      userText: params.userText,
      catalog: params.catalog,
      availableToolNames,
      state: params.state,
      webToolNames,
      catalogEnumeration,
      inventoryPreloaded: params.authoritativeToolDiscovery !== undefined,
      semanticScores: params.semanticToolScores,
      schemaTokenCosts: params.schemaTokenCosts,
      maxSchemaTokens: toolSchemaSelectionBudgetTokens({
        model: selectedModel,
        outputTokens: provisionalOutputTokens,
        baseReservedToolTokens,
      }),
    });
    // Runtime discovery results are one-step materialization hints. Once this
    // request has selected the bounded concrete schema set, release the hint so
    // lower-ranked search matches do not rotate into later steps and churn the
    // provider cache prefix. The selected set is retained separately below.
    params.state.requestedToolNames = [];
    params.state.materializedToolNames = activeTools;
    const stepReservedToolTokens = baseReservedToolTokens
      + sumToolSchemaTokenCosts(activeTools, params.schemaTokenCosts);
    params.state.reservedToolTokens = stepReservedToolTokens;
    const stepRoutingPlan: AgentRoutingPlan = {
      ...params.routingPlan,
      requirements: {
        ...params.routingPlan.requirements,
        reservedOutputTokens: provisionalOutputTokens,
        reservedToolTokens: stepReservedToolTokens,
      },
    };
    let modelOverride: LanguageModel | undefined;
    let selectionReason: "INITIAL" | "TOOL_LOOP" | "ESCALATION" =
      stepNumber === 0 ? "INITIAL" : "TOOL_LOOP";
    const routingInputTokens = Math.max(
      params.state.currentInputTokens,
      params.routingPlan.requirements.estimatedInputTokens,
    );
    const currentModelFits = modelSatisfiesRoutingRequirements(
      selectedModel,
      stepRoutingPlan.requirements,
      routingInputTokens,
    );
    if (shouldEscalate(params.state) || !currentModelFits) {
      params.state.escalationCount += 1;
      const escalationModel = getEscalationModel(
        stepRoutingPlan,
        params.state.escalationCount,
        routingInputTokens,
        selectedModel,
      );
      if (escalationModel) {
        params.state.currentModelKey = escalationModel.modelKey;
        params.state.currentModelId = escalationModel.providerModelId;
        params.state.invalidToolCallCount = 0;
        params.state.noProgressStepCount = 0;
        selectedModel = escalationModel;
        modelOverride = params.resolveLanguageModel
          ? await params.resolveLanguageModel({
              model: escalationModel,
              stepNumber,
              reason: "ESCALATION",
            })
          : await resolveAgentChatLanguageModel(escalationModel, { appAccountId: params.appAccountId });
        selectionReason = "ESCALATION";
      }
    }
    if (!modelOverride && params.resolveLanguageModel) {
      modelOverride = await params.resolveLanguageModel({
        model: selectedModel,
        stepNumber,
        reason: selectionReason,
      });
    }
    const stepMaxOutputTokens = getAgentStepOutputTokenLimit(
      selectedModel,
      params.profile,
      phase,
    );
    params.state.reservedOutputTokens = stepMaxOutputTokens;
    const inputLimit = computeModelInputLimit({
      model: selectedModel,
      outputTokens: stepMaxOutputTokens,
      reservedToolTokens: stepReservedToolTokens,
    });
    const componentBudgets = allocateContextComponentBudgets(inputLimit);
    // The context allocator is a real per-source allowance, not a collection of
    // independent maxima. Stable topology shares the stable-instruction budget;
    // task focus/domain guidance share the dynamic-instruction budget; concrete
    // JSON schemas remain charged only to the tool-schema bucket above.
    const stableCapabilityMapBudget = Math.min(1_500, Math.floor(componentBudgets.stableInstructions * 0.22));
    const stableBaseBudget = Math.max(1, componentBudgets.stableInstructions - stableCapabilityMapBudget);
    const baseInstructions = boundContextText(
      params.baseInstructions,
      stableBaseBudget,
      { reductionMarker: "\n...[creator/system overlay reduced to fit this model's stable-instruction budget]...\n" },
    );
    const capabilityMap = stableCapabilityMapBudget > 0
      ? boundContextText(params.capabilityMap ?? "", stableCapabilityMapBudget)
      : "";

    const capabilityFocusBudget = Math.min(900, Math.floor(componentBudgets.dynamicInstructions * 0.2));
    const domainGuidanceBudget = Math.min(900, Math.floor(componentBudgets.dynamicInstructions * 0.2));
    const requestContextBudget = Math.max(
      1,
      componentBudgets.dynamicInstructions - capabilityFocusBudget - domainGuidanceBudget,
    );
    const dynamicContextInstructions = boundContextText(
      params.dynamicContextInstructions ?? "",
      requestContextBudget,
    );
    const capabilityFocus = capabilityFocusBudget > 0
      ? boundContextText(params.capabilityFocus ?? "", capabilityFocusBudget)
      : "";
    const durableMemoryInstructions = boundContextText(
      params.durableMemoryInstructions ?? "",
      componentBudgets.durableMemory,
    );
    const phaseInstructions = buildPhaseInstructions(phase, stepNumber, {
      profile: params.profile,
    });
    const activeCatalog = params.catalog.filter((entry) => activeTools.includes(entry.name));
    const domainGuidance = domainGuidanceBudget > 0
      ? boundContextText(
          buildActiveDomainGuidance(params.profile.domains, activeCatalog),
          domainGuidanceBudget,
          { reductionMarker: "\n...[task-domain guidance reduced for this model window]...\n" },
        )
      : "";
    const instructionParams = {
      baseInstructions,
      phaseInstructions,
      phase,
      activeCatalog,
      authoritativeToolDiscovery: params.authoritativeToolDiscovery,
      dynamicContextInstructions,
      durableMemoryInstructions,
      capabilityMap,
      capabilityFocus,
      domainGuidance,
      mcpInstructions: boundMcpPromptInstructions(
        selectMcpPromptInstructions(
          params.mcpInstructions ?? [],
          activeCatalog,
        ),
        componentBudgets.mcpInstructions,
      ),
    };
    const rawInstructionRegions = composeAgentStepInstructionRegions(instructionParams);
    const instructionRegions = {
      ...rawInstructionRegions,
      volatile: boundContextText(
        rawInstructionRegions.volatile,
        componentBudgets.volatileInstructions,
        { reductionMarker: "\n...[step/inventory instructions reduced for this model window]...\n" },
      ),
    };
    const instructionText = [
      instructionRegions.stable,
      instructionRegions.request,
      instructionRegions.mcp,
      instructionRegions.volatile,
    ].filter(Boolean).join("\n\n");
    const instructions = buildCacheAwareSystemInstructions(selectedModel, instructionRegions);
    // System instructions occupy the same provider input context as messages.
    // Reserve the provider-neutral textual form before compiling history; the
    // Anthropic multi-message representation carries the same content.
    const messageInputLimit = Math.max(1, inputLimit - estimateTextTokens(instructionText));
    const compiled = await compileAgentContext({
      messages: contextMessages,
      tools: params.tools,
      maxInputTokens: messageInputLimit,
      externalizeToolResult: params.externalizeToolResult,
      relevanceQuery: params.userText,
      allowPlatformSemanticRanking: canUsePlatformSemanticRanking(selectedModel),
    });
    params.state.contextReductionLevel = Math.max(
      params.state.contextReductionLevel,
      compiled.reductionLevel,
    );
    const projectedMessages = compiled.messages;
    const projectedInputTokens = Math.max(
      1,
      estimateModelMessagesTokens(projectedMessages),
    );
    if (projectedInputTokens > messageInputLimit) {
      // History projection deliberately preserves the newest user/tool turn
      // atomically. If that irreducible turn alone cannot fit, fail locally
      // rather than relying on a provider-specific context-window rejection.
      throw new HttpError(
        413,
        "CONTEXT_TOO_LARGE",
        "The newest conversation turn exceeds the selected model's input context after tool and output reservations.",
        false,
        "SELECT_MODEL",
      );
    }
    params.state.currentInputTokens = projectedInputTokens;
    const statefulContinuation = projectOpenAiStatefulContinuation({
      model: selectedModel,
      messages: projectedMessages,
      steps: args.steps,
      enabled: params.supportsStatefulContinuation?.(selectedModel) === true,
      // Level 2 is lossless tool-result virtualization: when a fresh tool result
      // first enters the loop, the provider has not seen that result yet and can
      // safely receive the artifact projection as the delta. Level 3+ masks or
      // drops older material that can already exist behind previousResponseId,
      // so continuing provider state would silently reintroduce context that the
      // local compiler deliberately removed. Reset to the full compiled working
      // set at that boundary. Also stop chaining provider state once the local
      // working set is already near the message window: stateless cached input
      // gives overflow recovery a complete portable prompt instead of a tiny
      // previousResponseId delta whose hidden provider history cannot be reduced
      // by AgentRanking's low-level retry path.
      providerStateReuseSafe:
        compiled.reductionLevel < 3
        && projectedInputTokens
          <= Math.floor(messageInputLimit * STATEFUL_CONTINUATION_MAX_CONTEXT_UTILIZATION),
    });
    const requestMessages = statefulContinuation?.messages ?? projectedMessages;
    const cachedMessages = applyIncrementalPromptCaching(selectedModel, requestMessages);
    const providerOptions = mergeModelProviderOptions(
      buildReasoningProviderOptions(
        selectedModel,
        params.profile,
        phase,
        stepMaxOutputTokens,
      ),
      buildPromptCacheProviderOptions(
        selectedModel,
        params.cacheNamespace ?? `agent-chat:${params.appAccountId}`,
      ),
      buildProviderContextManagementOptions({
        model: selectedModel,
        usableInputTokens: inputLimit,
        stateChangingToolNames: [...new Set([
          ...providerProtectedToolNamesInContext(projectedMessages, params.tools),
          ...activeTools.filter((name) =>
            getToolEffect(params.tools[name])?.stateChanging === true,
          ),
        ])].sort(),
      }),
      statefulContinuation?.providerOptions,
    );
    const result: AgentPrepareStepResult = {
      activeTools,
      instructions,
      messages: cachedMessages,
      maxOutputTokens: stepMaxOutputTokens,
      ...(providerOptions ? { providerOptions } : {}),
      ...(modelOverride ? { model: modelOverride } : {}),
    };
    const explicitToolChoiceSupported = supportsExplicitToolChoice(selectedModel);
    // Match OpenCode's default runtime: expose the resolved tools directly and
    // let the model use normal automatic tool choice. Forced tool choice is a
    // caller/provider compatibility concern, not a task-semantic discovery gate.
    const toolChoiceMode: "auto" | "required" = "auto";
    await params.onModelSelected?.({
      stepNumber,
      model: selectedModel,
      reason: selectionReason,
    });
    await params.onStepPrepared?.({
      stepNumber,
      phase,
      activeTools,
      catalogToolCount: params.catalog.length,
      catalogEnumeration,
      inventoryPreloaded: params.authoritativeToolDiscovery !== undefined,
      explicitToolChoiceSupported,
      toolChoiceMode,
    });
    return result;
  };
}
// ── Conversation-state detection (exported for testing) ──
export function detectPhase(opts: {
  stepNumber: number;
  state: AgentOrchestrationState;
  profile: AgentTaskProfile;
  catalogEnumeration?: boolean;
  tools?: ToolSet;
}): AgentStepPhase {
  if (opts.state.runtimeToolInventoryListed) {
    return "SYNTHESIS";
  }
  if (opts.catalogEnumeration) {
    return "DISCOVERY";
  }
  // Step 0: DISCOVERY
  if (opts.stepNumber === 0) {
    return opts.profile.requiresTools ? "DISCOVERY" : "SYNTHESIS";
  }
  // After successful state-changing tool → VERIFICATION
  if (
    opts.profile.stateChangingIntent &&
    opts.state.successfulToolNames.length > 0
  ) {
    // Only if latest successful was a state-changing operation
    const latestSuccess =
      opts.state.successfulToolNames[opts.state.successfulToolNames.length - 1];
    const latestEffect = latestSuccess && opts.tools
      ? getToolEffect(opts.tools[latestSuccess])
      : undefined;
    if (latestSuccess && (latestEffect?.stateChanging === true || opts.tools === undefined)) {
      return "VERIFICATION";
    }
  }
  // Deferred discovery/search tools request concrete schemas for the following
  // step. Do not let the generic "enough successful tools" heuristic strand
  // those newly requested tools behind a synthesis-only step.
  if (opts.state.requestedToolNames.length > 0) {
    return "EXECUTION";
  }
  // Canonical context readers exist only to restore evidence that was already
  // part of the task state. Once a read succeeds and did not discover another
  // progressive-disclosure tool above, move directly to synthesis instead of
  // carrying the reader schema through an otherwise unnecessary execution step.
  const latestSuccess = opts.state.successfulToolNames.at(-1);
  if (latestSuccess && isContextRetrievalToolName(latestSuccess)) {
    return "SYNTHESIS";
  }
  // Sufficient evidence → SYNTHESIS
  if (opts.state.successfulToolNames.length >= 2) {
    return "SYNTHESIS";
  }
  // Failed tools remaining → EXECUTION (retry)
  if (opts.state.failedToolNames.length > 0) {
    return "EXECUTION";
  }
  // Default: EXECUTION
  return opts.profile.requiresTools ? "EXECUTION" : "SYNTHESIS";
}
// ── Progress State Tracking ──
function updateProgressState(
  state: AgentOrchestrationState,
  steps: Array<StepResult<ToolSet>>,
  currentStep: number,
  tools: ToolSet,
): void {
  if (currentStep === 0 || steps.length === 0) return;
  const prevStep = steps[steps.length - 1];
  const toolResults: Array<TypedToolResult<ToolSet>> = prevStep.toolResults ?? [];
  let madeProgress = false;
  if (toolResults.length > 0) {
    for (const tr of toolResults) {
      const outcome = normalizeToolOutcome(tr);
      const resultPayload = (tr as unknown as { output?: unknown; result?: unknown }).output
        ?? (tr as unknown as { result?: unknown }).result
        ?? tr;
      if (tr.toolName === "runtime_tool_search") {
        const requested = extractRuntimeToolNames(resultPayload, tools);
        state.requestedToolNames = [...new Set([...state.requestedToolNames, ...requested])].slice(-8);
      }
      if (
        tr.toolName === "search_previous_threads"
        && "read_conversation_history" in tools
        && hasSearchResults(resultPayload)
      ) {
        state.requestedToolNames = [...new Set([
          ...state.requestedToolNames,
          "read_conversation_history",
        ])].slice(-8);
      }
      if (
        tr.toolName === "search_tool_results"
        && "read_tool_result" in tools
        && hasSearchResults(resultPayload)
      ) {
        state.requestedToolNames = [...new Set([
          ...state.requestedToolNames,
          "read_tool_result",
        ])].slice(-8);
      }
      if (
        tr.toolName === "read_conversation_history"
        && "read_conversation_attachment" in tools
        && containsConversationAttachmentReference(resultPayload)
      ) {
        state.virtualizedAttachmentCount = Math.max(1, state.virtualizedAttachmentCount);
        state.requestedToolNames = [...new Set([
          ...state.requestedToolNames,
          "read_conversation_attachment",
        ])].slice(-8);
      }
      if (containsExternalizedArtifact(resultPayload)) {
        state.externalizedToolResultCount += 1;
      }
      if (outcome.terminalSuccess) {
        state.successfulToolNames.push(tr.toolName);
        state.failedToolNames = state.failedToolNames.filter((name) => name !== tr.toolName);
      } else if (!outcome.makesProgress) {
        state.failedToolNames.push(tr.toolName);
      }
      madeProgress ||= outcome.makesProgress;
    }
  }
  state.noProgressStepCount = madeProgress ? 0 : state.noProgressStepCount + 1;
  if (
    toolResults.some((tr) => {
      const outcome = normalizeToolOutcome(tr);
      return outcome.makesProgress
        && isWebSearchRuntimeTool(tr.toolName, tools);
    })
  ) {
    state.webSearchUsed = true;
  }
}

function hasSearchResults(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.results)) return object.results.length > 0;
  const nested = object.output ?? object.result ?? object.value;
  return nested === value ? false : hasSearchResults(nested);
}

function extractRuntimeToolNames(value: unknown, tools: ToolSet): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const object = value as Record<string, unknown>;
  const names = new Set<string>();
  const add = (candidate: unknown) => {
    if (typeof candidate === "string" && candidate in tools) names.add(candidate);
  };
  add(object.runtimeName);
  if (Array.isArray(object.runtimeNames)) for (const candidate of object.runtimeNames) add(candidate);
  if (Array.isArray(object.tools)) {
    for (const candidate of object.tools) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const entry = candidate as Record<string, unknown>;
      add(entry.runtimeName);
      add(entry.name);
    }
  }
  // Set insertion order preserves runtime search relevance. Alphabetically
  // sorting here would materialize whichever names happen to sort first rather
  // than the highest-ranked discovery results.
  return [...names];
}

function containsConversationAttachmentReference(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsConversationAttachmentReference(entry, depth + 1));
  }
  const object = value as Record<string, unknown>;
  if (
    object.readTool === "read_conversation_attachment"
    && typeof object.messageId === "string"
    && typeof object.partIndex === "number"
  ) {
    return true;
  }
  return Object.values(object).some((entry) =>
    containsConversationAttachmentReference(entry, depth + 1),
  );
}

function containsExternalizedArtifact(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  if (
    typeof object.artifactId === "string"
    && (object.status === "externalized" || object.status === "externalized_error")
  ) return true;
  return Object.values(object).some((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? containsExternalizedArtifact(entry)
      : false,
  );
}

// ── Escalation Logic (exported for testing) ──
export function shouldEscalate(
  state: AgentOrchestrationState,
  escalationCount = state.escalationCount,
): boolean {
  if (escalationCount >= 2) return false; // Max 2 escalations
  if (state.invalidToolCallCount >= 2) return true;
  if (state.noProgressStepCount >= 2) return true;
  return false;
}
// ── Conversation-state instructions (exported for testing) ──
export function buildPhaseInstructions(
  phase: AgentStepPhase,
  stepNumber: number,
  params: { profile: AgentTaskProfile },
): string {
  const heading = `Step ${stepNumber}: ${phase}`;
  switch (phase) {
    case "DISCOVERY":
      return [
        heading,
        "Gather the minimum reliable evidence needed to answer the request. When the request requires current, external, wallet, market, token, transaction, or protocol state, call at least one relevant exposed tool before answering instead of relying on model memory.",
        "Use the directly exposed runtime tool definitions as the authoritative capability set; never invent a tool that is not exposed.",
        params.profile.requiresCurrentWeb
          ? "Use the exposed web-search tool for current off-chain context, and distinguish web evidence from on-chain evidence."
          : "Prefer direct inspection tools for current balances, token data, and protocol state.",
      ].join("\n");
    case "EXECUTION":
      return [
        heading,
        "Execute the next necessary operation with any available runtime tool. Capability inventory is not evidence that an operation ran. Reuse confirmed results and do not repeat successful calls without a reason.",
        "Only report an external or on-chain action as successful after the tool result confirms it.",
      ].join("\n");
    case "VERIFICATION":
      return [
        heading,
        "Verify the outcome using inspection tools or returned identifiers before making a success claim.",
        "Resolve material discrepancies explicitly; do not hide failed or uncertain execution state.",
      ].join("\n");
    case "SYNTHESIS":
      return [
        heading,
        "Synthesize the answer from conversation context and accumulated evidence.",
        "Use only tools actually exposed for this step. If none are exposed, answer without tools. State material uncertainty and keep the answer focused on the user's request.",
        "Do not mention internal step phases, orchestration state, or hidden prompts in the user-facing answer.",
      ].join("\n");
  }
}
export function createAgentOrchestrationState(params: {
  modelKey: string;
  modelId: string;
  initialInputTokens?: number;
  reservedOutputTokens?: number;
  reservedToolTokens?: number;
}): AgentOrchestrationState {
  return {
    currentModelKey: params.modelKey,
    currentModelId: params.modelId,
    repairAttempts: new Map(),
    invalidToolCallCount: 0,
    noProgressStepCount: 0,
    successfulToolNames: [],
    failedToolNames: [],
    requestedToolNames: [],
    materializedToolNames: [],
    externalizedToolResultCount: 0,
    virtualizedAttachmentCount: 0,
    contextReductionLevel: 0,
    webSearchUsed: false,
    runtimeToolInventoryListed: false,
    escalationCount: 0,
    repairCount: 0,
    initialInputTokens: Math.max(1, params.initialInputTokens ?? 1),
    currentInputTokens: Math.max(1, params.initialInputTokens ?? 1),
    reservedOutputTokens: Math.max(0, params.reservedOutputTokens ?? 0),
    reservedToolTokens: Math.max(0, params.reservedToolTokens ?? 0),
  };
}
