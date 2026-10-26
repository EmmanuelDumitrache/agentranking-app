import "server-only";

import { mcpCredentialSummary } from "./credentials";
import { getMcpProviderManifest, toPublicMcpProvider } from "./provider-registry";
import { hydrateCatalog } from "./repository";
import type {
  McpBindingRecord,
  McpConnectionRecord,
  McpToolDescriptorRecord,
  McpToolPolicyRecord,
  McpToolRisk,
} from "./types";

const RISK_ORDER: McpToolRisk[] = [
  "UNKNOWN",
  "CUSTODY",
  "PAYMENT",
  "BROADCAST",
  "SIGN",
  "TRADE",
  "INFRA_ADMIN",
  "WRITE_OFFCHAIN",
  "TRANSACTION_PREPARE",
  "ANALYTICS_QUERY",
  "READ_ONLY",
];

function riskSummary(tools: readonly McpToolDescriptorRecord[]) {
  const counts = Object.fromEntries(
    RISK_ORDER.map((risk) => [
      risk,
      tools.filter((tool) => tool.active && tool.effectiveRisk === risk).length,
    ]),
  ) as Record<McpToolRisk, number>;
  return {
    counts,
    highestRisk: RISK_ORDER.find((risk) => counts[risk] > 0) ?? null,
    active: tools.filter((tool) => tool.active).length,
    quarantined: tools.filter((tool) => tool.active && tool.quarantined).length,
    removed: tools.filter((tool) => !tool.active).length,
  };
}

function publicAuditMetadata(value: unknown): Record<string, string | number | boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowed = new Set([
    "providerKey",
    "endpointOrigin",
    "catalogRevision",
    "previousRevision",
    "revision",
    "retainedCatalogRevision",
    "added",
    "changed",
    "removed",
    "quarantined",
    "durationMs",
    "requestBytes",
    "responseBytes",
    "retryCount",
  ]);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, entry]) => allowed.has(key) && ["string", "number", "boolean"].includes(typeof entry))
    .map(([key, entry]) => [key, entry as string | number | boolean] as const);
  return entries.length ? Object.fromEntries(entries) : null;
}

export function toDashboardMcpConnection(connection: McpConnectionRecord) {
  const catalog = hydrateCatalog(connection.catalog);
  const manifest = getMcpProviderManifest(connection.providerKey);
  const bindings = (connection.bindings ?? []) as Array<McpBindingRecord & {
    agent?: { id: number; name: string; image: string };
  }>;
  return {
    id: connection.id,
    runtimeKey: connection.runtimeKey,
    displayName: connection.displayName,
    providerKey: connection.providerKey,
    provider: manifest ? toPublicMcpProvider(manifest) : null,
    unreviewed: connection.providerKey === null,
    providerManifestMissing: Boolean(connection.providerKey && !manifest),
    endpointOrigin: connection.endpointOrigin,
    endpointHost: connection.endpointHost,
    transport: connection.transportMode,
    status: connection.status,
    statusReasonCode: connection.statusReasonCode,
    statusMessage: connection.statusMessage,
    credential: mcpCredentialSummary(connection),
    serverName: connection.serverName,
    serverVersion: connection.serverVersion,
    protocolVersion: connection.protocolVersion,
    catalogRevision: connection.catalogRevision,
    catalogHash: connection.catalogHash,
    catalogFetchedAt: catalog?.fetchedAt ?? null,
    catalogValidUntil: catalog?.validUntil ?? null,
    toolSummary: riskSummary(connection.tools ?? []),
    attachedAgents: bindings.map((binding) => ({
      id: binding.agentDbId,
      name: binding.agent?.name ?? `Agent ${binding.agentDbId}`,
      image: binding.agent?.image ?? "",
      bindingId: binding.id,
      enabled: binding.enabled,
    })),
    lastVerifiedAt: connection.lastVerifiedAt,
    lastDiscoveredAt: connection.lastDiscoveredAt,
    lastHealthyAt: connection.lastHealthyAt,
    consecutiveFailures: connection.consecutiveFailures,
    disabledAt: connection.disabledAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    version: connection.version,
    recentEvents: (connection.auditLogs ?? []).map((event) => ({
      id: event.id,
      action: event.action,
      status: event.status,
      reasonCode: event.reasonCode,
      metadata: publicAuditMetadata(event.metadataJson),
      createdAt: event.createdAt,
    })),
  };
}

export function toDashboardMcpBinding(binding: McpBindingRecord | null) {
  if (!binding) return null;
  return {
    id: binding.id,
    enabled: binding.enabled,
    approvalMode: binding.approvalMode,
    maxCallsPerRun: binding.maxCallsPerRun,
    maxParallelCalls: binding.maxParallelCalls,
    callTimeoutMs: binding.callTimeoutMs,
    outputByteLimit: binding.outputByteLimit,
    version: binding.version,
    overriddenToolCount: binding.toolPolicies?.length ?? 0,
  };
}

export function toDashboardMcpTool(params: {
  descriptor: McpToolDescriptorRecord;
  policy: McpToolPolicyRecord | null;
  binding: McpBindingRecord;
  platformBlocked?: boolean;
  platformReason?: string | null;
}) {
  const descriptor = params.descriptor;
  const policy = params.policy;
  const input = descriptor.inputSchema && typeof descriptor.inputSchema === "object"
    ? descriptor.inputSchema as Record<string, unknown>
    : {};
  const output = descriptor.outputSchema && typeof descriptor.outputSchema === "object"
    ? descriptor.outputSchema as Record<string, unknown>
    : null;
  return {
    id: descriptor.id,
    name: descriptor.name,
    title: descriptor.title,
    description: descriptor.description,
    effectiveRisk: descriptor.effectiveRisk,
    inferredRisk: descriptor.inferredRisk,
    providerRisk: descriptor.providerRisk,
    riskReason: descriptor.riskReason,
    active: descriptor.active,
    quarantined: descriptor.quarantined,
    quarantineAcknowledged: !params.platformBlocked
      && policy?.acknowledgedSchemaHash === descriptor.schemaHash,
    quarantineReason: params.platformReason ?? descriptor.quarantineReason,
    platformBlocked: params.platformBlocked ?? false,
    schemaHash: descriptor.schemaHash,
    previousSchemaHash: descriptor.previousSchemaHash,
    revision: descriptor.revision,
    schemaChanged: Boolean(descriptor.previousSchemaHash),
    enabled: !params.platformBlocked && (policy?.enabled ?? true),
    approvalMode: policy?.approvalMode ?? params.binding.approvalMode,
    inheritedApproval: !policy?.approvalMode,
    maxCallsPerRun: policy?.maxCallsPerRun ?? params.binding.maxCallsPerRun,
    acknowledgedSchemaHash: policy?.acknowledgedSchemaHash ?? null,
    inputSummary: {
      type: typeof input.type === "string" ? input.type : "object",
      required: Array.isArray(input.required) ? input.required : [],
      fields: input.properties && typeof input.properties === "object"
        ? Object.keys(input.properties as Record<string, unknown>).slice(0, 100)
        : [],
    },
    outputSummary: output
      ? {
          type: typeof output.type === "string" ? output.type : "object",
          fields: output.properties && typeof output.properties === "object"
            ? Object.keys(output.properties as Record<string, unknown>).slice(0, 100)
            : [],
        }
      : null,
    lastDiscoveredAt: descriptor.lastSeenAt,
  };
}
