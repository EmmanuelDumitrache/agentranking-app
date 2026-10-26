import "server-only";

import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { Counter, Histogram } from "prom-client";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";

type RunSpanState = {
  span: Span;
  context: Context;
  startedAt: number;
};

type AttemptSpanState = {
  span: Span;
  startedAt: number;
};

type ChatPrometheusMetrics = {
  runs: Counter<"outcome" | "provider">;
  runDuration: Histogram<"outcome" | "provider">;
  firstToken: Histogram<"provider">;
  tokens: Counter<"direction" | "provider">;
  chargeCents: Counter<"provider">;
  tools: Counter<"state">;
  toolDuration: Histogram;
  modelAttempts: Counter<"outcome" | "provider">;
  modelAttemptDuration: Histogram<"outcome" | "provider">;
  routing: Counter<"reason">;
};

const globalObservability = globalThis as typeof globalThis & {
  __agentChatRunSpans?: Map<string, RunSpanState>;
  __agentChatAttemptSpans?: Map<string, AttemptSpanState>;
  __agentChatPrometheusMetrics?: ChatPrometheusMetrics;
};

const runSpans = (globalObservability.__agentChatRunSpans ??= new Map());
const attemptSpans = (globalObservability.__agentChatAttemptSpans ??= new Map());
const tracer = trace.getTracer("agentranking.agent-chat", "1.0.0");
const meter = metrics.getMeter("agentranking.agent-chat", "1.0.0");

const otelRuns = meter.createCounter("agent_chat.runs", {
  description: "Agent chat runs by terminal outcome and provider.",
});
const otelRunDuration = meter.createHistogram("agent_chat.run.duration", {
  description: "Agent chat terminal duration in milliseconds.",
  unit: "ms",
});
const otelFirstToken = meter.createHistogram("agent_chat.first_token.duration", {
  description: "Agent chat time to first generated token in milliseconds.",
  unit: "ms",
});
const otelTokens = meter.createCounter("agent_chat.tokens", {
  description: "Agent chat tokens by direction and provider.",
  unit: "{token}",
});
const otelCharge = meter.createCounter("agent_chat.charge", {
  description: "AgentRanking LLM credit charges in cents.",
  unit: "{cent}",
});
const otelTools = meter.createCounter("agent_chat.tool.calls", {
  description: "Agent chat tool calls by terminal state.",
});
const otelToolDuration = meter.createHistogram("agent_chat.tool.duration", {
  description: "Agent chat tool execution duration in milliseconds.",
  unit: "ms",
});
const otelModelAttempts = meter.createCounter("agent_chat.model.attempts", {
  description: "Provider model attempts by terminal outcome.",
});
const otelModelAttemptDuration = meter.createHistogram("agent_chat.model.attempt.duration", {
  description: "Provider model attempt duration in milliseconds.",
  unit: "ms",
});
const otelRouting = meter.createCounter("agent_chat.routing.decisions", {
  description: "Agent chat routing decisions by bounded reason.",
});

function prometheus(): ChatPrometheusMetrics {
  return (globalObservability.__agentChatPrometheusMetrics ??= {
    runs: new Counter({
      name: "agent_chat_runs_total",
      help: "Agent chat runs by terminal outcome and provider.",
      labelNames: ["outcome", "provider"],
    }),
    runDuration: new Histogram({
      name: "agent_chat_run_duration_seconds",
      help: "Agent chat terminal duration in seconds.",
      labelNames: ["outcome", "provider"],
      buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 45, 90, 180],
    }),
    firstToken: new Histogram({
      name: "agent_chat_first_token_duration_seconds",
      help: "Agent chat time to first generated token in seconds.",
      labelNames: ["provider"],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 45],
    }),
    tokens: new Counter({
      name: "agent_chat_tokens_total",
      help: "Agent chat tokens by direction and provider.",
      labelNames: ["direction", "provider"],
    }),
    chargeCents: new Counter({
      name: "agent_chat_charge_cents_total",
      help: "AgentRanking LLM credit charges in cents by provider.",
      labelNames: ["provider"],
    }),
    tools: new Counter({
      name: "agent_chat_tool_calls_total",
      help: "Agent chat tool calls by terminal state.",
      labelNames: ["state"],
    }),
    toolDuration: new Histogram({
      name: "agent_chat_tool_duration_seconds",
      help: "Agent chat tool execution duration in seconds.",
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    }),
    modelAttempts: new Counter({
      name: "agent_chat_model_attempts_total",
      help: "Provider model attempts by terminal outcome and provider.",
      labelNames: ["outcome", "provider"],
    }),
    modelAttemptDuration: new Histogram({
      name: "agent_chat_model_attempt_duration_seconds",
      help: "Provider model attempt duration in seconds.",
      labelNames: ["outcome", "provider"],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 45, 90],
    }),
    routing: new Counter({
      name: "agent_chat_routing_decisions_total",
      help: "Agent chat routing decisions by bounded reason.",
      labelNames: ["reason"],
    }),
  });
}

function boundedLabel(value: string | undefined, fallback = "unknown"): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return normalized.slice(0, 96);
}

function safeAttributes(attributes: Attributes): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") output[key] = value.slice(0, 256);
    else output[key] = value;
  }
  return output;
}

function attemptKey(runId: string, sequence: number): string {
  return `${runId}:${sequence}`;
}

export function startRunSpan(input: {
  runId: string;
  agentDbId: number;
  provider: string;
  model: string;
}): void {
  if (runSpans.has(input.runId)) return;
  const span = tracer.startSpan(
    "agent_chat.run",
    {
      attributes: safeAttributes({
        "agent_chat.run_id": input.runId,
        "agent_chat.agent_db_id": input.agentDbId,
        "gen_ai.system": boundedLabel(input.provider),
        "gen_ai.request.model": boundedLabel(input.model),
      }),
    },
    context.active(),
  );
  runSpans.set(input.runId, {
    span,
    context: trace.setSpan(context.active(), span),
    startedAt: Date.now(),
  });
}

export function finishRunSpan(input: {
  runId: string;
  provider: string;
  outcome: "completed" | "failed" | "cancelled";
  durationMs?: number;
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  chargeCents?: number;
}): void {
  const provider = boundedLabel(input.provider);
  const durationMs = Math.max(0, input.durationMs ?? 0);
  const labels = { outcome: input.outcome, provider };
  prometheus().runs.inc(labels);
  otelRuns.add(1, labels);
  if (durationMs > 0) {
    prometheus().runDuration.observe(labels, durationMs / 1_000);
    otelRunDuration.record(durationMs, labels);
  }
  if (typeof input.inputTokens === "number" && input.inputTokens >= 0) {
    const tokenLabels = { direction: "input", provider };
    prometheus().tokens.inc(tokenLabels, input.inputTokens);
    otelTokens.add(input.inputTokens, tokenLabels);
  }
  if (typeof input.outputTokens === "number" && input.outputTokens >= 0) {
    const tokenLabels = { direction: "output", provider };
    prometheus().tokens.inc(tokenLabels, input.outputTokens);
    otelTokens.add(input.outputTokens, tokenLabels);
  }
  if (typeof input.chargeCents === "number" && input.chargeCents > 0) {
    prometheus().chargeCents.inc({ provider }, input.chargeCents);
    otelCharge.add(input.chargeCents, { provider });
  }

  const state = runSpans.get(input.runId);
  if (!state) return;
  state.span.setAttributes(
    safeAttributes({
      "agent_chat.outcome": input.outcome,
      "agent_chat.duration_ms": durationMs || Date.now() - state.startedAt,
      "agent_chat.error_code": input.errorCode,
      "gen_ai.usage.input_tokens": input.inputTokens,
      "gen_ai.usage.output_tokens": input.outputTokens,
      "agent_chat.charge_cents": input.chargeCents,
    }),
  );
  state.span.setStatus(
    input.outcome === "completed"
      ? { code: SpanStatusCode.OK }
      : { code: SpanStatusCode.ERROR, message: boundedLabel(input.errorCode, input.outcome) },
  );
  state.span.end();
  runSpans.delete(input.runId);
  for (const [key, attempt] of attemptSpans) {
    if (!key.startsWith(`${input.runId}:`)) continue;
    attempt.span.setStatus({ code: SpanStatusCode.ERROR, message: "run_terminated" });
    attempt.span.end();
    attemptSpans.delete(key);
  }
}

export function recordFirstToken(input: {
  runId: string;
  provider: string;
  durationMs: number;
}): void {
  const provider = boundedLabel(input.provider);
  const durationMs = Math.max(0, input.durationMs);
  prometheus().firstToken.observe({ provider }, durationMs / 1_000);
  otelFirstToken.record(durationMs, { provider });
  runSpans.get(input.runId)?.span.addEvent("agent_chat.first_token", {
    "agent_chat.first_token_ms": durationMs,
  });
}

export function recordRoutingDecision(input: {
  runId?: string;
  reason: string;
  requestedModel?: string;
  effectiveModel?: string;
}): void {
  const reason = boundedLabel(input.reason);
  prometheus().routing.inc({ reason });
  otelRouting.add(1, { reason });
  if (input.runId) {
    runSpans.get(input.runId)?.span.addEvent(
      "agent_chat.routing",
      safeAttributes({
        "agent_chat.routing.reason": reason,
        "agent_chat.requested_model": input.requestedModel,
        "agent_chat.effective_model": input.effectiveModel,
      }),
    );
  }
}

export function startModelAttemptSpan(input: {
  runId: string;
  sequence: number;
  provider: string;
  model: string;
  reason: string;
}): void {
  const key = attemptKey(input.runId, input.sequence);
  if (attemptSpans.has(key)) return;
  const parent = runSpans.get(input.runId)?.context ?? context.active();
  const span = tracer.startSpan(
    "agent_chat.model_attempt",
    {
      attributes: safeAttributes({
        "agent_chat.run_id": input.runId,
        "agent_chat.attempt_sequence": input.sequence,
        "agent_chat.attempt_reason": input.reason,
        "gen_ai.system": boundedLabel(input.provider),
        "gen_ai.request.model": boundedLabel(input.model),
      }),
    },
    parent,
  );
  attemptSpans.set(key, { span, startedAt: Date.now() });
}

export function finishModelAttemptSpan(input: {
  runId: string;
  sequence: number;
  provider: string;
  outcome: "completed" | "failed";
}): void {
  const provider = boundedLabel(input.provider);
  const key = attemptKey(input.runId, input.sequence);
  const state = attemptSpans.get(key);
  const durationMs = state ? Math.max(0, Date.now() - state.startedAt) : 0;
  const labels = { outcome: input.outcome, provider };
  prometheus().modelAttempts.inc(labels);
  otelModelAttempts.add(1, labels);
  if (durationMs > 0) {
    prometheus().modelAttemptDuration.observe(labels, durationMs / 1_000);
    otelModelAttemptDuration.record(durationMs, labels);
  }
  if (!state) return;
  state.span.setStatus({
    code: input.outcome === "completed" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
  });
  state.span.end();
  attemptSpans.delete(key);
}

export async function withToolExecutionSpan<T>(input: {
  runId?: string;
  toolName: string;
  stateChanging: boolean;
  execute: () => Promise<T>;
}): Promise<T> {
  const parent = input.runId ? runSpans.get(input.runId)?.context : undefined;
  const startedAt = Date.now();
  const span = tracer.startSpan(
    "agent_chat.tool",
    {
      attributes: safeAttributes({
        "agent_chat.run_id": input.runId,
        "agent_chat.tool_name": boundedLabel(input.toolName),
        "agent_chat.tool_state_changing": input.stateChanging,
      }),
    },
    parent ?? context.active(),
  );
  try {
    const result = await context.with(trace.setSpan(parent ?? context.active(), span), input.execute);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    const safe = safeErrorDetails(error);
    span.recordException(new Error(safe.message));
    span.setStatus({ code: SpanStatusCode.ERROR, message: safe.name });
    throw error;
  } finally {
    const durationMs = Math.max(0, Date.now() - startedAt);
    prometheus().toolDuration.observe(durationMs / 1_000);
    otelToolDuration.record(durationMs);
    span.end();
  }
}

export function recordToolTerminalState(state: "started" | "completed" | "failed"): void {
  prometheus().tools.inc({ state });
  otelTools.add(1, { state });
}

export function addRunSpanEvent(runId: string, name: string, attributes: Attributes = {}): void {
  runSpans.get(runId)?.span.addEvent(name.slice(0, 96), safeAttributes(attributes));
}