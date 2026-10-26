import { boundedJsonPreview } from "@/lib/bounded-json-preview";
import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";
import {
  finishModelAttemptSpan,
  finishRunSpan,
  recordFirstToken,
  recordRoutingDecision,
  recordToolTerminalState,
  startModelAttemptSpan,
  startRunSpan,
} from "./observability";
export type ChatEvent = {
  event: string;
  runId: string;
  threadId?: string;
  agentDbId?: number;
  appAccountId?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  chargeCents?: number;
  providerCostUsdMicros?: string; // bigint serialized as string for JSON
  errorCode?: string;
  toolName?: string;
  stepIndex?: number;
  state?: string;
  toolSource?: string;
  sourceConnectionId?: string;
  sourceToolName?: string;
  sourceDisplayName?: string;
  sequence?: number;
  reason?: string;
  modelKey?: string;
  fromModel?: string;
  toModel?: string;
  failureKind?: string;
  failoverEligible?: boolean;
  credentialDisposition?: string;
};
export function emitEvent(event: ChatEvent): void {
  // Structured logging
  const logData = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  const rawPayload = process.env.NODE_ENV === "production"
    ? { ...logData, service: "agent-chat" }
    : logData;
  const payload = redactSensitiveData(rawPayload);
  const { text } = boundedJsonPreview(payload, {
    maxChars: 16_000,
    maxDepth: 5,
    maxEntriesPerContainer: 64,
    maxNodes: 512,
    maxStringChars: 2_000,
    indent: 0,
  });
  if (process.env.NODE_ENV !== "production") {
    console.log("[chat.telemetry]", text);
  } else {
    console.log(text);
  }
}
export async function trackRunStarted(params: {
  runId: string;
  threadId: string;
  agentDbId: number;
  appAccountId: string;
  provider: string;
  model: string;
}): Promise<void> {
  startRunSpan({
    runId: params.runId,
    agentDbId: params.agentDbId,
    provider: params.provider,
    model: params.model,
  });
  emitEvent({ event: "chat.run.started", ...params });
}
export async function trackRunCompleted(params: {
  runId: string;
  threadId: string;
  provider: string;
  model: string;
  durationMs: number;
  tokenUsage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  chargeCents: number;
  providerCostUsdMicros?: string;
}): Promise<void> {
  finishRunSpan({
    runId: params.runId,
    provider: params.provider,
    outcome: "completed",
    durationMs: params.durationMs,
    inputTokens: params.tokenUsage.inputTokens,
    outputTokens: params.tokenUsage.outputTokens,
    chargeCents: params.chargeCents,
  });
  emitEvent({ event: "chat.run.completed", ...params });
}
export async function trackRunFailed(params: {
  runId: string;
  threadId: string;
  provider: string;
  model: string;
  errorCode: string;
  durationMs?: number;
}): Promise<void> {
  finishRunSpan({
    runId: params.runId,
    provider: params.provider,
    outcome: params.errorCode === "REQUEST_CANCELLED" ? "cancelled" : "failed",
    durationMs: params.durationMs,
    errorCode: params.errorCode,
  });
  emitEvent({ event: "chat.run.failed", ...params });
}
export async function trackToolCall(params: {
  runId: string;
  toolName: string;
  stepIndex: number;
  state: "started" | "completed" | "failed" | "timed_out" | "cancelled";
  durationMs?: number;
  toolSource?: string;
  sourceConnectionId?: string;
  sourceToolName?: string;
  sourceDisplayName?: string;
}): Promise<void> {
  if (params.state !== "started") {
    recordToolTerminalState(params.state === "completed" ? "completed" : "failed");
  }
  emitEvent({ event: `chat.tool.${params.state}`, ...params });
}

export function trackFirstToken(params: {
  runId: string;
  provider: string;
  durationMs: number;
}): void {
  recordFirstToken(params);
}

export function trackModelAttemptStarted(params: {
  runId: string;
  sequence: number;
  provider: string;
  model: string;
  modelKey?: string;
  reason: string;
}): void {
  startModelAttemptSpan(params);
  emitEvent({ event: "chat.model.attempt.started", ...params });
}

export function trackModelAttemptFailed(params: {
  runId: string;
  sequence: number;
  provider: string;
  model: string;
  modelKey?: string;
  reason?: string;
  failureKind: string;
  failoverEligible: boolean;
  credentialDisposition: string;
}): void {
  finishModelAttemptSpan({
    runId: params.runId,
    sequence: params.sequence,
    provider: params.provider,
    outcome: "failed",
  });
  emitEvent({ event: "chat.model.attempt.failed", ...params });
}

export function trackModelFailover(params: {
  runId: string;
  sequence: number;
  provider: string;
  model: string;
  fromModel: string;
  toModel: string;
  reason: string;
}): void {
  emitEvent({ event: "chat.model.failover", ...params });
}

export function trackModelAttemptCompleted(params: {
  runId: string;
  sequence: number;
  provider: string;
}): void {
  finishModelAttemptSpan({ ...params, outcome: "completed" });
}
// ── Orchestration telemetry ─────────────────────────────────────────────
export type AgentOrchestrationTelemetry = {
  runId: string;
  step?: number;
  requestedModel?: string;
  effectiveModel?: string;
  routingReason?: string;
  taskDomains?: string[];
  activeToolCount?: number;
  catalogToolCount?: number;
  catalogQuery?: boolean;
  inventoryPreloaded?: boolean;
  explicitToolChoiceSupported?: boolean;
  toolChoiceMode?: "auto" | "required";
  activeToolNamesHash?: string;
  activeToolSchemaBytes?: number;
  phase?: string;
  webSearchActive?: boolean;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  repairStage?: string;
  retryLayer?: string;
  retryAttempt?: number;
  retryReason?: string;
};
export function emitOrchestrationEvent(
  event: string,
  data: AgentOrchestrationTelemetry,
): void {
  emitEvent({ event: `chat.${event}`, ...data } as ChatEvent);
}
export function emitTaskProfiled(data: AgentOrchestrationTelemetry) {
  emitOrchestrationEvent("task.profiled", data);
}
export function emitToolsSelected(data: AgentOrchestrationTelemetry) {
  emitOrchestrationEvent("tools.selected", data);
}
export function emitStepPrepared(data: AgentOrchestrationTelemetry) {
  emitOrchestrationEvent("step.prepared", data);
}
export function emitToolRepairAttempted(data: AgentOrchestrationTelemetry) {
  emitOrchestrationEvent("tool.repair_attempted", data);
}
export function emitModelRouted(data: AgentOrchestrationTelemetry) {
  if (data.routingReason) {
    recordRoutingDecision({
      runId: data.runId,
      reason: data.routingReason,
      requestedModel: data.requestedModel,
      effectiveModel: data.effectiveModel,
    });
  }
  emitOrchestrationEvent("model.routed", data);
}
export function emitModelEscalated(data: AgentOrchestrationTelemetry) {
  if (data.routingReason) {
    recordRoutingDecision({
      runId: data.runId,
      reason: data.routingReason,
      requestedModel: data.requestedModel,
      effectiveModel: data.effectiveModel,
    });
  }
  emitOrchestrationEvent("model.escalated", data);
}
