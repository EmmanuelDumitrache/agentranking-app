import { boundedJsonPreview } from "@/lib/bounded-json-preview";
import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
import {
  computeModelInputLimit,
  estimateCharacterCountTokens,
} from "./token-budget";

/**
 * Provider-independent reservation estimators. Runtime context selection is
 * intentionally owned only by prepareStep/projectMessagesToBudget.
 */
export function charsToTokens(chars: number): number {
  return estimateCharacterCountTokens(chars);
}

/**
 * Estimate JSON characters without allowing serialization to traverse or
 * allocate an unbounded payload. A truncated value consumes the caller's full
 * logical cap, which keeps credit reservation conservative.
 */
export function estimateJsonCharsForBudget(
  value: unknown,
  logicalLimitChars: number,
): number {
  const logicalLimit = Number.isFinite(logicalLimitChars)
    ? Math.max(1, Math.trunc(logicalLimitChars))
    : 1;
  const previewLimit = Math.min(1_000_000, logicalLimit);
  const preview = boundedJsonPreview(value, {
    maxChars: previewLimit,
    maxDepth: 12,
    maxEntriesPerContainer: 500,
    maxNodes: 50_000,
    maxStringChars: previewLimit,
    indent: 0,
  });
  return preview.truncated ? logicalLimit : Math.min(logicalLimit, preview.text.length);
}

export type ContextDemandInput = {
  systemPromptChars: number;
  currentMessageChars: number;
  historyMessageChars: number[];
  safetyTokens: number;
};

/**
 * Model-independent demand for the non-tool portion of the compiled working
 * set. Concrete/deferred tool schemas have a separate reservation path and
 * must not be mixed back into this estimate.
 */
export function estimateContextDemandTokens(input: ContextDemandInput): number {
  return Math.max(
    1,
    charsToTokens(input.systemPromptChars)
      + charsToTokens(input.currentMessageChars)
      + input.historyMessageChars.reduce((sum, chars) => sum + charsToTokens(chars), 0)
      + Math.max(0, input.safetyTokens),
  );
}

export type ContextComponentBudgets = {
  stableInstructions: number;
  dynamicInstructions: number;
  mcpInstructions: number;
  volatileInstructions: number;
  toolSchemas: number;
  durableMemory: number;
  conversationSummary: number;
  workingState: number;
  recentProtectedHistory: number;
  historicalWorkingSet: number;
  toolInputs: number;
  toolObservations: number;
  retrievedArtifacts: number;
};

export type MessageContextComponentBudgets = Pick<
  ContextComponentBudgets,
  | "conversationSummary"
  | "workingState"
  | "recentProtectedHistory"
  | "historicalWorkingSet"
  | "toolInputs"
  | "toolObservations"
  | "retrievedArtifacts"
>;

/**
 * Soft per-component targets. They prevent any single context source from
 * silently treating the whole model window as its own budget; the final
 * context compiler remains the hard invariant.
 */
export function allocateContextComponentBudgets(
  usableInputTokens: number,
): ContextComponentBudgets {
  const usable = Math.max(1, Math.trunc(usableInputTokens));
  // These are overlapping source ceilings, not a partition of the window:
  // historicalWorkingSet includes tool inputs/observations that also have their
  // own stricter caps. Ratios therefore need not sum to 1.0. Absolute maxima
  // create additional spare headroom on large-context models.
  const cap = (ratio: number, maximum: number) =>
    Math.max(1, Math.min(maximum, Math.floor(usable * ratio)));
  return {
    stableInstructions: cap(0.06, 6_000),
    dynamicInstructions: cap(0.04, 4_000),
    mcpInstructions: cap(0.04, 4_000),
    volatileInstructions: cap(0.04, 4_000),
    toolSchemas: cap(0.06, 6_000),
    durableMemory: cap(0.025, 2_500),
    conversationSummary: cap(0.035, 3_500),
    workingState: cap(0.03, 3_000),
    recentProtectedHistory: cap(0.18, 24_000),
    historicalWorkingSet: cap(0.24, 32_000),
    toolInputs: cap(0.06, 8_000),
    toolObservations: cap(0.15, 18_000),
    retrievedArtifacts: cap(0.1, 14_000),
  };
}

/**
 * A token window can still be degraded by hundreds of tiny historical turns:
 * role/tool envelopes, repeated acknowledgements and cache breakpoints carry a
 * real provider cost even when their text is small. Keep the model-facing
 * working set bounded by turn count as well as tokens, while scaling the cap
 * with the usable message window. Exact older turns remain canonical and can be
 * selectively reopened through conversation-history retrieval.
 */
export function historicalWorkingTurnLimit(usableMessageTokens: number): number {
  const usable = Math.max(1, Math.trunc(usableMessageTokens));
  return Math.max(12, Math.min(48, Math.floor(usable / 4_000)));
}

/**
 * Allocate the context compiler's already-net message window. System/dynamic
 * instructions, MCP guidance, durable memory, and concrete tool schemas have
 * been charged before compileAgentContext() is called, so reserving their
 * full-prompt shares again would double-count them and prematurely discard
 * useful conversation/tool evidence.
 */
export function allocateMessageContextBudgets(
  usableMessageTokens: number,
): MessageContextComponentBudgets {
  const usable = Math.max(1, Math.trunc(usableMessageTokens));
  const cap = (ratio: number, maximum: number) =>
    Math.max(1, Math.min(maximum, Math.floor(usable * ratio)));
  return {
    conversationSummary: cap(0.05, 3_500),
    workingState: cap(0.04, 3_000),
    recentProtectedHistory: cap(0.25, 24_000),
    historicalWorkingSet: cap(0.32, 32_000),
    toolInputs: cap(0.08, 8_000),
    toolObservations: cap(0.20, 18_000),
    retrievedArtifacts: cap(0.14, 14_000),
  };
}


/**
 * Soft schema allowance before concrete tools are materialized. Compute this
 * from the model window after output/base-runtime reservations but before tool
 * schemas themselves are charged; this avoids a circular "select schemas to
 * know the schema budget" dependency while still making schema size a first-
 * class selection constraint.
 */
export function toolSchemaSelectionBudgetTokens(params: {
  model: AgentChatModelDefinition;
  outputTokens: number;
  baseReservedToolTokens: number;
}): number {
  const preSchemaInputLimit = computeModelInputLimit({
    model: params.model,
    outputTokens: params.outputTokens,
    reservedToolTokens: params.baseReservedToolTokens,
  });
  return allocateContextComponentBudgets(preSchemaInputLimit).toolSchemas;
}

export function boundContextText(
  text: string,
  maxTokens: number,
  options: { reductionMarker?: string } = {},
): string {
  const maxChars = Math.max(16, Math.trunc(maxTokens) * 4);
  if (text.length <= maxChars) return text;
  const marker = options.reductionMarker
    ?? "\n...[context section reduced; exact source remains available through its owning subsystem]...\n";
  if (maxChars <= marker.length + 2) return text.slice(0, maxChars);
  const half = Math.max(1, Math.floor((maxChars - marker.length) / 2));
  return `${text.slice(0, half)}${marker}${text.slice(-half)}`;
}
