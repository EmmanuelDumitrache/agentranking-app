import "server-only";

import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
} from "@opentelemetry/api";
import { Counter, Gauge, Histogram } from "prom-client";
import { prisma } from "@/lib/db";
import { redactSensitiveText } from "@/lib/security/sensitive-data-redaction";
import { mcpErrorCode, safeMcpErrorDetails } from "./errors";
import {
  getMcpProviderManifest,
  providerAllowsExistingConnection,
} from "./provider-registry";

type McpPrometheusMetrics = {
  operations: Counter<"operation" | "outcome" | "provider" | "risk" | "reason">;
  duration: Histogram<"operation" | "outcome" | "provider" | "risk" | "reason">;
  transactions: Counter<"provider">;
  events: Counter<"event" | "outcome" | "provider" | "risk" | "reason">;
  bytes: Histogram<"direction" | "provider" | "risk">;
  catalogChanges: Counter<"provider" | "change">;
  connections: Gauge<"provider" | "status" | "auth" | "transport">;
  bindings: Gauge<"provider" | "risk">;
  catalogTools: Gauge<"provider" | "risk" | "quarantined">;
};

const globalMcpObservability = globalThis as typeof globalThis & {
  __mcpPrometheusMetrics?: McpPrometheusMetrics;
};
const tracer = trace.getTracer("agentranking.mcp", "1.0.0");
const meter = metrics.getMeter("agentranking.mcp", "1.0.0");
const operationCounter = meter.createCounter("mcp.operations", {
  description: "MCP operations by bounded operation, provider, risk, and outcome.",
});
const operationDuration = meter.createHistogram("mcp.operation.duration", {
  description: "MCP operation duration in milliseconds.",
  unit: "ms",
});
const transactionIntents = meter.createCounter("mcp.transaction_intents", {
  description: "Unsigned MCP transaction intents handed to native controls.",
});

function prometheus(): McpPrometheusMetrics {
  return (globalMcpObservability.__mcpPrometheusMetrics ??= {
    operations: new Counter({
      name: "mcp_operations_total",
      help: "MCP operations by bounded operation, provider, risk, and outcome.",
      labelNames: ["operation", "outcome", "provider", "risk", "reason"],
    }),
    duration: new Histogram({
      name: "mcp_operation_duration_seconds",
      help: "MCP operation duration by bounded operation, provider, risk, and outcome.",
      labelNames: ["operation", "outcome", "provider", "risk", "reason"],
      buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60],
    }),
    transactions: new Counter({
      name: "mcp_unsigned_transaction_intents_total",
      help: "Unsigned MCP transaction intents handed to native controls.",
      labelNames: ["provider"],
    }),
    events: new Counter({
      name: "mcp_events_total",
      help: "Bounded MCP lifecycle, approval, circuit, OAuth, policy, and rate-limit events.",
      labelNames: ["event", "outcome", "provider", "risk", "reason"],
    }),
    bytes: new Histogram({
      name: "mcp_tool_bytes",
      help: "MCP tool request and response byte sizes.",
      labelNames: ["direction", "provider", "risk"],
      buckets: [128, 512, 2_048, 8_192, 32_768, 131_072, 524_288, 1_048_576],
    }),
    catalogChanges: new Counter({
      name: "mcp_catalog_changes_total",
      help: "MCP catalog additions, material changes, removals, and quarantines.",
      labelNames: ["provider", "change"],
    }),
    connections: new Gauge({
      name: "mcp_connections",
      help: "Current MCP connections by bounded provider, status, auth, and transport.",
      labelNames: ["provider", "status", "auth", "transport"],
      async collect() {
        this.reset();
        const rows = await prisma.agentMcpConnection.groupBy({
          by: ["providerKey", "status", "authMode", "transportMode"],
          where: { deletedAt: null },
          _count: { _all: true },
        });
        for (const row of rows) {
          this.set({
            provider: bounded(row.providerKey, "custom"),
            status: bounded(row.status),
            auth: bounded(row.authMode),
            transport: bounded(row.transportMode),
          }, row._count._all);
        }
      },
    }),
    bindings: new Gauge({
      name: "mcp_enabled_bindings",
      help: "Current enabled MCP binding/tool-risk exposures by provider and risk.",
      labelNames: ["provider", "risk"],
      async collect() {
        this.reset();
        const rows = await prisma.$queryRaw<Array<{
          provider: string;
          risk: string;
          count: bigint;
        }>>`
          SELECT COALESCE(c.provider_key, 'custom') AS provider,
                 t.effective_risk::text AS risk,
                 COUNT(DISTINCT b.id) AS count
            FROM agent_mcp_bindings b
            JOIN agent_mcp_connections c ON c.id = b.connection_id
            JOIN agent_mcp_tool_descriptors t ON t.connection_id = c.id
       LEFT JOIN agent_mcp_tool_policies p
              ON p.binding_id = b.id
             AND p.connection_id = c.id
             AND p.tool_id = t.id
           WHERE b.enabled = true
             AND b.approval_mode <> 'BLOCK_ALL'
             AND c.deleted_at IS NULL
             AND c.disabled_at IS NULL
             AND c.status IN ('READY', 'DEGRADED')
             AND t.active = true
             AND COALESCE(p.enabled, true) = true
             AND t.effective_risk::text NOT IN ('SIGN', 'BROADCAST', 'PAYMENT', 'CUSTODY')
             AND (
               t.quarantined = false
               OR (
                 p.acknowledged_schema_hash IS NOT NULL
                 AND p.acknowledged_schema_hash = t.schema_hash
               )
             )
           GROUP BY COALESCE(c.provider_key, 'custom'), t.effective_risk
        `;
        for (const row of rows) {
          if (
            row.provider !== "custom"
            && !providerAllowsExistingConnection(getMcpProviderManifest(row.provider), row.provider)
          ) continue;
          this.set({ provider: bounded(row.provider), risk: bounded(row.risk) }, Number(row.count));
        }
      },
    }),
    catalogTools: new Gauge({
      name: "mcp_catalog_tools",
      help: "Current MCP catalog tools by provider, risk, and quarantine state.",
      labelNames: ["provider", "risk", "quarantined"],
      async collect() {
        this.reset();
        const rows = await prisma.$queryRaw<Array<{
          provider: string;
          risk: string;
          quarantined: boolean;
          count: bigint;
        }>>`
          SELECT COALESCE(c.provider_key, 'custom') AS provider,
                 t.effective_risk::text AS risk,
                 t.quarantined,
                 COUNT(*) AS count
            FROM agent_mcp_tool_descriptors t
            JOIN agent_mcp_connections c ON c.id = t.connection_id
           WHERE c.deleted_at IS NULL AND t.active = true
           GROUP BY COALESCE(c.provider_key, 'custom'), t.effective_risk, t.quarantined
        `;
        for (const row of rows) {
          this.set({
            provider: bounded(row.provider),
            risk: bounded(row.risk),
            quarantined: row.quarantined ? "true" : "false",
          }, Number(row.count));
        }
      },
    }),
  });
}

function bounded(value: string | null | undefined, fallback = "unknown"): string {
  return value?.trim().slice(0, 80) || fallback;
}

const SAFE_TRACE_ATTRIBUTE_KEYS = new Set([
  "mcp.provider",
  "mcp.risk",
  "mcp.connection_id",
  "mcp.binding_id",
  "mcp.descriptor_id",
  "mcp.catalog_revision",
  "mcp.schema_hash_prefix",
  "mcp.transport",
  "mcp.request_bytes",
]);

function safeAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(Object.entries(attributes)
    .filter(([key, value]) => SAFE_TRACE_ATTRIBUTE_KEYS.has(key) && value !== undefined && value !== null)
    .map(([key, value]) => [
      key,
      typeof value === "string"
        ? redactSensitiveText(value).slice(0, 256)
        : value,
    ]));
}

export async function withObservedMcpOperation<T>(params: {
  spanName:
    | "mcp.resolve_bindings"
    | "mcp.verify_connection"
    | "mcp.initialize"
    | "mcp.discover_tools"
    | "mcp.oauth.discover"
    | "mcp.oauth.token"
    | "mcp.invoke"
    | "mcp.approval.wait"
    | "mcp.transaction.normalize";
  operation: string;
  providerKey?: string | null;
  risk?: string | null;
  attributes?: Attributes;
  task: () => Promise<T>;
}): Promise<T> {
  const provider = bounded(params.providerKey, params.providerKey === null ? "custom" : "unknown");
  const risk = bounded(params.risk);
  const startedAt = Date.now();
  const span = tracer.startSpan(params.spanName, {
    attributes: safeAttributes({
      "mcp.provider": provider,
      "mcp.risk": risk,
      ...params.attributes,
    }),
  }, context.active());
  let outcome = "succeeded";
  let reason = "none";
  try {
    const result = await context.with(trace.setSpan(context.active(), span), params.task);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    outcome = "failed";
    reason = bounded(mcpErrorCode(error));
    const safe = safeMcpErrorDetails(error);
    span.recordException(new Error(safe.message));
    span.setStatus({ code: SpanStatusCode.ERROR, message: safe.code ?? safe.name });
    throw error;
  } finally {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const labels = { operation: bounded(params.operation), outcome, provider, risk, reason };
    operationCounter.add(1, labels);
    operationDuration.record(durationMs, labels);
    prometheus().operations.inc(labels);
    prometheus().duration.observe(labels, durationMs / 1_000);
    span.setAttribute("mcp.duration_ms", durationMs);
    span.end();
  }
}

export function recordMcpTransactionIntent(providerKey: string | null): void {
  const provider = bounded(providerKey, "custom");
  transactionIntents.add(1, { provider });
  prometheus().transactions.inc({ provider });
}

export function recordMcpOperationalEvent(params: {
  event:
    | "approval"
    | "circuit"
    | "oauth"
    | "policy"
    | "rate_limit"
    | "transaction_simulation"
    | "transaction_signing"
    | "transaction_broadcast";
  outcome: string;
  providerKey?: string | null;
  risk?: string | null;
  reason?: string | null;
}): void {
  prometheus().events.inc({
    event: bounded(params.event),
    outcome: bounded(params.outcome),
    provider: bounded(params.providerKey, params.providerKey === null ? "custom" : "unknown"),
    risk: bounded(params.risk),
    reason: bounded(params.reason, "none"),
  });
}

export function recordMcpToolBytes(params: {
  providerKey: string | null;
  risk: string;
  requestBytes: number;
  responseBytes: number;
}): void {
  const labels = {
    provider: bounded(params.providerKey, "custom"),
    risk: bounded(params.risk),
  };
  prometheus().bytes.observe({ ...labels, direction: "request" }, Math.max(0, params.requestBytes));
  prometheus().bytes.observe({ ...labels, direction: "response" }, Math.max(0, params.responseBytes));
}

export function recordMcpCatalogChanges(params: {
  providerKey: string | null;
  added: number;
  changed: number;
  removed: number;
  quarantined: number;
}): void {
  const provider = bounded(params.providerKey, "custom");
  for (const change of ["added", "changed", "removed", "quarantined"] as const) {
    const count = Math.max(0, Math.trunc(params[change]));
    if (count > 0) prometheus().catalogChanges.inc({ provider, change }, count);
  }
}
