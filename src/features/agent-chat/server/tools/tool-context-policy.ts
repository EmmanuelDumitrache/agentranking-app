import "server-only";

import type { ToolSet } from "ai";
import { getMcpToolMetadata } from "../mcp/tool-metadata";
import { getAgentRuntimeToolMetadata } from "./provider-tools";
import { getToolEffect } from "./tool-effects";

export type ToolContextStrategy =
  | "inline"
  | "head-tail"
  | "structured-preview"
  | "externalize"
  | "distill";

export type ToolContextPolicy = {
  inlineTokenLimit: number;
  retainedTurns: number;
  strategy: ToolContextStrategy;
  preserveOnError: boolean;
  preserveIfStateChanging: boolean;
};

const DEFAULT_POLICY: ToolContextPolicy = {
  inlineTokenLimit: 2_000,
  retainedTurns: 3,
  strategy: "structured-preview",
  preserveOnError: true,
  preserveIfStateChanging: true,
};

const LOW_VOLUME_READ_PATTERN = /(?:^|_)(?:balance|status|metadata|price|quote|account|wallet)(?:_|$)/i;
const BULK_READ_PATTERN = /(?:transactions?|history|logs?|search|list|scan|events?|records?|holders?|portfolio|activity|trace|dump|query|fetch_all)/i;
const STATE_CHANGE_PATTERN = /(?:send|transfer|swap|trade|stake|unstake|deposit|withdraw|borrow|repay|mint|burn|claim|bridge|pay|issue|cancel|create|launch|approve)/i;

export const CONTEXT_RETRIEVAL_TOOL_NAMES = new Set([
  "read_tool_result",
  "search_tool_results",
  "read_conversation_history",
  "read_conversation_attachment",
  "search_previous_threads",
]);

export function isContextRetrievalToolName(toolName: string): boolean {
  return CONTEXT_RETRIEVAL_TOOL_NAMES.has(toolName);
}

export function toolAppearsStateChanging(params: {
  toolName: string;
  tool?: ToolSet[string];
  stateChanging?: boolean;
}): boolean {
  const declaredEffect = params.tool ? getToolEffect(params.tool)?.stateChanging : undefined;
  if (params.stateChanging === true || declaredEffect === true) return true;
  if (declaredEffect === false || params.stateChanging === false) return false;
  // Historical messages can outlive the runtime tool that produced them. When
  // authoritative effect metadata is no longer available, preserve the same
  // conservative mutation-name fallback used by the context policy.
  return STATE_CHANGE_PATTERN.test(params.toolName);
}

export function resolveToolContextPolicy(params: {
  toolName: string;
  tool?: ToolSet[string];
  stateChanging?: boolean;
}): ToolContextPolicy {
  // Runtime effect metadata is authoritative when present. The name heuristic
  // is only a conservative fallback for third-party/provider tools that do not
  // declare an effect; otherwise read actions such as get_mint_metadata or
  // get_stake_accounts are incorrectly promoted to mutation-grade retention.
  const stateChanging = toolAppearsStateChanging({
    toolName: params.toolName,
    tool: params.tool,
    stateChanging: params.stateChanging,
  });

  // Rehydration/search tools already return deliberately bounded projections.
  // Re-externalizing those projections would create artifact-of-artifact loops
  // where the model can never actually inspect the detail it requested. Keep a
  // small number of these bounded reads inline; later context compilation
  // collapses stale reads back to their original artifact/message references
  // instead of recursively creating artifacts from retrieval views.
  if (params.toolName === "read_conversation_attachment") {
    return {
      // Non-image model files use a larger conservative provider-media token
      // allowance than images. Keep one exact rehydrated file visible for the
      // current step rather than immediately head/tail-truncating its transport.
      inlineTokenLimit: 10_000,
      retainedTurns: 1,
      strategy: "inline",
      preserveOnError: true,
      preserveIfStateChanging: false,
    };
  }
  if (
    params.toolName === "read_tool_result"
    || params.toolName === "read_conversation_history"
  ) {
    return {
      inlineTokenLimit: 6_500,
      retainedTurns: 2,
      strategy: "inline",
      preserveOnError: true,
      preserveIfStateChanging: false,
    };
  }
  if (params.toolName === "search_tool_results" || params.toolName === "search_previous_threads") {
    return {
      inlineTokenLimit: 5_000,
      retainedTurns: 2,
      strategy: "structured-preview",
      preserveOnError: true,
      preserveIfStateChanging: false,
    };
  }
  if (params.toolName === "delegate_context_analysis") {
    return {
      inlineTokenLimit: 2_500,
      retainedTurns: 2,
      strategy: "inline",
      preserveOnError: true,
      preserveIfStateChanging: false,
    };
  }

  if (stateChanging) {
    return {
      inlineTokenLimit: 3_000,
      retainedTurns: 8,
      strategy: "structured-preview",
      preserveOnError: true,
      preserveIfStateChanging: true,
    };
  }

  const mcp = params.tool ? getMcpToolMetadata(params.tool) : undefined;
  if (mcp?.kind === "server_tool") {
    return {
      inlineTokenLimit: 2_500,
      retainedTurns: 3,
      strategy: "externalize",
      preserveOnError: true,
      preserveIfStateChanging: true,
    };
  }

  const runtime = params.tool ? getAgentRuntimeToolMetadata(params.tool) : undefined;
  if (runtime?.capability === "web_search") {
    return {
      inlineTokenLimit: 3_500,
      retainedTurns: 3,
      strategy: "structured-preview",
      preserveOnError: true,
      preserveIfStateChanging: false,
    };
  }

  if (LOW_VOLUME_READ_PATTERN.test(params.toolName)) {
    return {
      inlineTokenLimit: 700,
      retainedTurns: 5,
      strategy: "inline",
      preserveOnError: true,
      preserveIfStateChanging: false,
    };
  }

  if (BULK_READ_PATTERN.test(params.toolName)) {
    return {
      inlineTokenLimit: 1_800,
      retainedTurns: 2,
      strategy: "externalize",
      preserveOnError: true,
      preserveIfStateChanging: false,
    };
  }

  return DEFAULT_POLICY;
}

const TOOL_RESULT_ERROR_STATES = new Set([
  "error",
  "failed",
  "failure",
  "rejected",
  "blocked",
  "denied",
  "invalid",
  "invalid_input",
  "validation_error",
  "unavailable",
  "timeout",
  "timed_out",
  "expired",
  "cancelled",
  "canceled",
  "aborted",
  "refused",
  "declined",
  "not_approved",
  "tool_error",
]);

export function toolResultAppearsError(value: unknown): boolean {
  if (Error.isError(value)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const wrapperType = typeof record.type === "string"
    ? record.type.toLowerCase()
    : "";
  if (
    wrapperType === "tool-error"
    || wrapperType === "error"
    || wrapperType === "error-json"
    || wrapperType === "error-text"
  ) return true;
  if (
    (wrapperType === "json" || wrapperType === "text")
    && "value" in record
    && record.value !== value
  ) {
    return toolResultAppearsError(record.value);
  }
  if (record.ok === false || record.success === false || record.isError === true) return true;
  if ("error" in record && record.error != null) return true;
  const rawState = typeof record.status === "string"
    ? record.status
    : typeof record.state === "string"
      ? record.state
      : "";
  const state = rawState.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return TOOL_RESULT_ERROR_STATES.has(state);
}
