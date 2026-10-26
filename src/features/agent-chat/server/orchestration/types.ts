import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
// §5 — Agent task profiling
export type AgentTaskDomain =
  | "wallet"
  | "balance"
  | "token"
  | "market"
  | "transfer"
  | "trade"
  | "swap"
  | "staking"
  | "defi"
  | "nft"
  | "launch"
  | "blink"
  | "transaction"
  | "web"
  | "general";
export type AgentTaskComplexity = "low" | "medium" | "high";
export type AgentTaskProfile = {
  requiresTools: boolean;
  requiresCurrentWeb: boolean;
  requiresVision: boolean;
  prefersReasoning: boolean;
  stateChangingIntent: boolean;
  catalogQuery: boolean;
  domains: readonly AgentTaskDomain[];
  complexity: AgentTaskComplexity;
  estimatedContextTokens: number;
  evidence: readonly string[];
};
// §6 — Tool catalog entry
export type ToolSelectionEntry = {
  /** Runtime function identifier passed to the language model. */
  name: string;
  plugin: string;
  description: string;
  similes: readonly string[];
  schemaFields: readonly string[];
  normalizedTerms: readonly string[];
  source?: "local" | "provider" | "mcp_server" | "mcp_runtime";
  /** Human-facing title; never required for tool invocation. */
  displayName?: string;
  /** Original MCP protocol tool name when source=mcp_server. */
  externalName?: string;
  /** Human-facing MCP server name when applicable. */
  serverName?: string;
};
// §9 — Agent orchestration state
export type AgentStepPhase =
  | "DISCOVERY"
  | "EXECUTION"
  | "VERIFICATION"
  | "SYNTHESIS";
export type AgentOrchestrationState = {
  currentModelKey: string;
  currentModelId: string;
  repairAttempts: Map<string, number>;
  invalidToolCallCount: number;
  noProgressStepCount: number;
  successfulToolNames: string[];
  failedToolNames: string[];
  requestedToolNames: string[];
  /** Concrete schemas materialized on the preceding model step for cache-stable reuse. */
  materializedToolNames: string[];
  externalizedToolResultCount: number;
  /** Historical image/file parts replaced by canonical message-backed attachment references. */
  virtualizedAttachmentCount: number;
  contextReductionLevel: number;
  webSearchUsed: boolean;
  runtimeToolInventoryListed: boolean;
  escalationCount: number;
  repairCount: number;
  initialInputTokens: number;
  currentInputTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
};
// §13 — Agent routing
export type AgentRoutingRequirements = {
  requiresTools: boolean;
  requiresVision: boolean;
  prefersReasoning: boolean;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  webSearch: boolean;
};
export type AgentRouteReason =
  | "REQUESTED_MODEL_COMPATIBLE"
  | "REQUESTED_MODEL_LACKS_TOOLS"
  | "REQUESTED_MODEL_LACKS_VISION"
  | "REQUESTED_MODEL_LACKS_WEB_SEARCH"
  | "INSUFFICIENT_CONTEXT";
export type AgentRoutingPlan = {
  requestedModel: AgentChatModelDefinition;
  primaryModel: AgentChatModelDefinition;
  fallbackModels: readonly AgentChatModelDefinition[];
  reason: AgentRouteReason;
  requirements: AgentRoutingRequirements;
  routingPolicy: string;
};
