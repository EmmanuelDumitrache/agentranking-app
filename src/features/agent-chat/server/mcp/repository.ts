import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { canonicalMcpJson, MCP_DISCOVERY_LIMITS, mcpToolSchemaHash } from "./catalog-validation";
import { McpRuntimeError, mcpErrorCode, safeMcpErrorDetails } from "./errors";
import type {
  McpCatalogRecord,
  McpCatalogSnapshot,
  McpConnectionRecord,
  McpConnectionStatus,
  McpToolDefinition,
  McpToolRisk,
} from "./types";
import type { McpRiskClassification } from "./risk";

const DEFAULT_CATALOG_TTL_MS = 24 * 60 * 60_000;
const STATUS_WRITE_INTERVAL_MS = 10 * 60_000;
const MAX_ERROR_CHARS = 2_000;
export const MAX_MCP_CATALOG_BYTES = MCP_DISCOVERY_LIMITS.maxCatalogBytes;
export const MAX_MCP_CATALOG_STALE_MS = 7 * 24 * 60 * 60_000;

const RISK_RANK: Record<McpToolRisk, number> = {
  READ_ONLY: 0,
  ANALYTICS_QUERY: 1,
  TRANSACTION_PREPARE: 2,
  WRITE_OFFCHAIN: 3,
  INFRA_ADMIN: 4,
  TRADE: 5,
  SIGN: 6,
  BROADCAST: 7,
  PAYMENT: 8,
  CUSTODY: 9,
  UNKNOWN: 10,
};

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(
    value,
    (_key, item) => typeof item === "bigint" ? item.toString() : item,
  )) as Prisma.InputJsonValue;
}

export function digestJson(value: unknown): string {
  return createHash("sha256").update(canonicalMcpJson(value)).digest("hex");
}

export function mcpCatalogPrincipalDigest(params: {
  connection: Pick<McpConnectionRecord, "endpointFingerprint" | "providerKey" | "manifestVersion">;
  credentialFingerprint?: string | null;
}): string {
  return digestJson({
    v: 3,
    endpointFingerprint: params.connection.endpointFingerprint,
    providerKey: params.connection.providerKey,
    manifestVersion: params.connection.manifestVersion,
    credentialFingerprint: params.credentialFingerprint ?? "anonymous",
  });
}

function connectionPrincipalDigest(
  connection: Pick<McpConnectionRecord, "endpointFingerprint" | "providerKey" | "manifestVersion" | "credential">,
): string {
  return mcpCatalogPrincipalDigest({
    connection,
    credentialFingerprint: connection.credential?.fingerprint,
  });
}

async function currentPrincipalDigest(
  connection: Pick<McpConnectionRecord, "id" | "endpointFingerprint" | "providerKey" | "manifestVersion">,
  manifestVersion = connection.manifestVersion,
): Promise<string> {
  const credential = await prisma.agentMcpCredential.findUnique({
    where: { connectionId: connection.id },
    select: { fingerprint: true },
  });
  return mcpCatalogPrincipalDigest({
    connection: { ...connection, manifestVersion },
    credentialFingerprint: credential?.fingerprint,
  });
}

const connectionInclude = {
  credential: true,
  catalog: true,
  tools: { orderBy: { name: "asc" as const } },
  bindings: {
    orderBy: { createdAt: "asc" as const },
    include: {
      toolPolicies: true,
      agent: { select: { id: true, name: true, image: true } },
    },
  },
  auditLogs: {
    orderBy: { createdAt: "desc" as const },
    take: 20,
  },
} as const;

export async function listMcpConnections(params: {
  appAccountId: string;
  includeDeleted?: boolean;
}): Promise<McpConnectionRecord[]> {
  const rows = await prisma.agentMcpConnection.findMany({
    where: {
      appAccountId: params.appAccountId,
      deletedAt: params.includeDeleted ? undefined : null,
    },
    include: connectionInclude,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows as unknown as McpConnectionRecord[];
}

export async function getMcpConnection(params: {
  appAccountId: string;
  connectionId: string;
  includeDeleted?: boolean;
}): Promise<McpConnectionRecord | null> {
  const row = await prisma.agentMcpConnection.findFirst({
    where: {
      id: params.connectionId,
      appAccountId: params.appAccountId,
      deletedAt: params.includeDeleted ? undefined : null,
    },
    include: connectionInclude,
  });
  return row as unknown as McpConnectionRecord | null;
}

export async function createMcpConnectionRecord(params: {
  appAccountId: string;
  providerKey: string | null;
  displayName: string;
  endpoint: { url: string; origin: string; host: string; fingerprint: string };
  authMode: McpConnectionRecord["authMode"];
  transportMode: McpConnectionRecord["transportMode"];
  manifestVersion: number | null;
  idempotencyKey?: string;
}): Promise<{ connection: McpConnectionRecord; created: boolean }> {
  const findIdempotent = async () => params.idempotencyKey
    ? await prisma.agentMcpConnection.findFirst({
        where: {
          appAccountId: params.appAccountId,
          idempotencyKey: params.idempotencyKey,
        },
        include: connectionInclude,
      })
    : null;
  if (params.idempotencyKey) {
    const existing = await findIdempotent();
    if (existing) return { connection: existing as unknown as McpConnectionRecord, created: false };
  }
  try {
    const row = await prisma.agentMcpConnection.create({
      data: {
        appAccountId: params.appAccountId,
        providerKey: params.providerKey,
        runtimeKey: `${params.displayName
          .normalize("NFKD")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 24) || "connection"}_${randomBytes(6).toString("hex")}`,
        displayName: params.displayName,
        endpointUrl: params.endpoint.url,
        endpointOrigin: params.endpoint.origin,
        endpointHost: params.endpoint.host,
        endpointFingerprint: params.endpoint.fingerprint,
        authMode: params.authMode,
        transportMode: params.transportMode,
        manifestVersion: params.manifestVersion,
        idempotencyKey: params.idempotencyKey,
        status: params.authMode === "OAUTH2_AUTHORIZATION_CODE" ? "AUTH_PENDING" : "DRAFT",
      },
      include: connectionInclude,
    });
    return { connection: row as unknown as McpConnectionRecord, created: true };
  } catch (error) {
    if (
      params.idempotencyKey
      && error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      const existing = await findIdempotent();
      if (existing) return { connection: existing as unknown as McpConnectionRecord, created: false };
    }
    throw error;
  }
}

export async function updateMcpConnectionStatus(params: {
  connectionId: string;
  status: McpConnectionStatus;
  reasonCode?: string | null;
  message?: string | null;
  error?: unknown;
  expectedVersion?: number;
  expectedStatuses?: McpConnectionStatus[];
  allowControlledStateOverride?: boolean;
}): Promise<boolean> {
  const now = new Date();
  const errorCode = params.error ? mcpErrorCode(params.error) : params.reasonCode ?? null;
  const errorText = params.error
    ? JSON.stringify(safeMcpErrorDetails(params.error)).slice(0, MAX_ERROR_CHARS)
    : params.message?.slice(0, 500) ?? null;
  const healthy = params.status === "READY";
  const recordsFailure = !healthy && (
    Boolean(params.error)
    || !["DRAFT", "VERIFYING", "AUTH_PENDING", "DISABLED"].includes(params.status)
  );
  const writeCutoff = new Date(now.getTime() - STATUS_WRITE_INTERVAL_MS);
  const updated = await prisma.agentMcpConnection.updateMany({
    where: {
      id: params.connectionId,
      deletedAt: null,
      version: params.expectedVersion,
      ...(params.expectedStatuses?.length
        ? { status: { in: params.expectedStatuses } }
        : !params.allowControlledStateOverride
          ? {
              status: {
                notIn: ["DISABLED", "BLOCKED", "DELETED", "REAUTH_REQUIRED"] as McpConnectionStatus[],
              },
            }
          : {}),
      OR: healthy
        ? [
            { status: { not: "READY" } },
            { statusReasonCode: { not: null } },
            { lastHealthyAt: null },
            { lastHealthyAt: { lt: writeCutoff } },
            { lastErrorAt: { not: null } },
            { consecutiveFailures: { gt: 0 } },
            { circuitOpenedAt: { not: null } },
            { circuitOpenUntil: { not: null } },
          ]
        : recordsFailure
          ? [
            { status: { not: params.status } },
            { lastErrorAt: null },
            { lastErrorAt: { lt: writeCutoff } },
          ]
          : [{ status: { not: params.status } }],
    },
    data: {
      status: params.status,
      statusReasonCode: healthy ? null : errorCode,
      statusMessage: healthy ? null : errorText?.slice(0, 500),
      lastConnectedAt: healthy ? now : undefined,
      lastHealthyAt: healthy ? now : undefined,
      lastErrorAt: healthy ? null : recordsFailure ? now : undefined,
      lastErrorCode: healthy ? null : recordsFailure ? errorCode : undefined,
      lastErrorText: healthy ? null : recordsFailure ? errorText : undefined,
      consecutiveFailures: healthy ? 0 : undefined,
      circuitOpenedAt: healthy ? null : undefined,
      circuitOpenUntil: healthy ? null : undefined,
    },
  });
  return updated.count === 1;
}

export async function recordMcpSuccessfulTransport(params: {
  connectionId: string;
  transport: "STREAMABLE_HTTP" | "LEGACY_SSE";
}): Promise<void> {
  await prisma.agentMcpConnection.updateMany({
    where: { id: params.connectionId, deletedAt: null },
    data: { lastSuccessfulTransport: params.transport },
  });
}

function catalogTools(value: unknown): McpToolDefinition[] | null {
  if (!Array.isArray(value)) return null;
  const result: McpToolDefinition[] = [];
  for (const valueTool of value) {
    if (!valueTool || typeof valueTool !== "object" || Array.isArray(valueTool)) return null;
    const tool = valueTool as McpToolDefinition;
    if (!tool.name || !tool.inputSchema || typeof tool.inputSchema !== "object") return null;
    result.push(tool);
  }
  return result;
}

export function hydrateCatalog(record: McpCatalogRecord | null): McpCatalogSnapshot | null {
  if (!record) return null;
  const tools = catalogTools(record.toolsJson);
  if (!tools) return null;
  return {
    protocolEra: record.protocolEra,
    protocolVersion: record.protocolVersion,
    serverInfo: record.serverInfoJson,
    capabilities: record.capabilitiesJson,
    discover: record.discoverJson,
    instructions: record.instructions,
    tools,
    resources: Array.isArray(record.resourcesJson) ? record.resourcesJson : null,
    resourceTemplates: Array.isArray(record.resourceTemplatesJson) ? record.resourceTemplatesJson : null,
    prompts: Array.isArray(record.promptsJson) ? record.promptsJson : null,
    toolsDigest: record.toolsDigest,
    endpointSnapshot: record.endpointSnapshot,
    principalDigest: record.principalDigest,
    fetchedAt: record.fetchedAt,
    validUntil: record.validUntil,
  };
}

export function isCatalogReusableForConnection(
  catalog: McpCatalogSnapshot | null,
  connection: Pick<McpConnectionRecord, "endpointUrl" | "endpointFingerprint" | "providerKey" | "manifestVersion" | "credential">,
): catalog is McpCatalogSnapshot {
  return Boolean(
    catalog
      && catalog.endpointSnapshot === connection.endpointUrl
      && catalog.principalDigest === connectionPrincipalDigest(connection)
      && (!catalog.validUntil || catalog.validUntil.getTime() > 0),
  );
}

export function isCatalogFresh(
  catalog: McpCatalogSnapshot | null,
  connection: Pick<McpConnectionRecord, "endpointUrl" | "endpointFingerprint" | "providerKey" | "manifestVersion" | "credential">,
  now = Date.now(),
): boolean {
  return Boolean(
    isCatalogReusableForConnection(catalog, connection)
      && catalog.validUntil
      && catalog.validUntil.getTime() > now,
  );
}

export function isCatalogWithinMaximumStaleAge(
  catalog: McpCatalogSnapshot | null,
  now = Date.now(),
): catalog is McpCatalogSnapshot {
  return Boolean(catalog && now - catalog.fetchedAt.getTime() <= MAX_MCP_CATALOG_STALE_MS);
}

export type ClassifiedMcpTool = {
  definition: McpToolDefinition;
  classification: McpRiskClassification;
};

export type McpCatalogChangeSummary = {
  previousRevision: number;
  revision: number;
  added: number;
  changed: number;
  removed: number;
  quarantined: number;
};

export async function saveMcpCatalog(params: {
  connection: McpConnectionRecord;
  protocolEra?: string;
  protocolVersion?: string;
  serverInfo?: unknown;
  capabilities?: unknown;
  discover?: unknown;
  instructions?: string;
  tools: ClassifiedMcpTool[];
  resources?: unknown[];
  resourceTemplates?: unknown[];
  prompts?: unknown[];
  ttlMs?: number;
  manifestVersion?: number | null;
  finalConnectionStatus?: "READY" | "DISABLED";
}): Promise<{ catalog: McpCatalogSnapshot; changes: McpCatalogChangeSummary }> {
  const toolDefinitions = params.tools.map((tool) => tool.definition);
  const payload = {
    protocolEra: params.protocolEra ?? null,
    protocolVersion: params.protocolVersion ?? null,
    serverInfo: params.serverInfo ?? null,
    capabilities: params.capabilities ?? null,
    discover: params.discover ?? null,
    instructions: params.instructions ?? null,
    tools: toolDefinitions,
    resources: params.resources ?? null,
    resourceTemplates: params.resourceTemplates ?? null,
    prompts: params.prompts ?? null,
  };
  if (Buffer.byteLength(canonicalMcpJson(payload), "utf8") > MAX_MCP_CATALOG_BYTES) {
    throw new McpRuntimeError(
      "MCP_DISCOVERY_LIMIT_EXCEEDED",
      "MCP catalog exceeds the persistence limit",
    );
  }
  const fetchedAt = new Date();
  const principalDigest = await currentPrincipalDigest(
    params.connection,
    params.manifestVersion ?? null,
  );
  const ttlMs = Number.isFinite(params.ttlMs)
    ? Math.max(60_000, Math.min(24 * 60 * 60_000, Math.trunc(params.ttlMs!)))
    : DEFAULT_CATALOG_TTL_MS;
  const validUntil = new Date(fetchedAt.getTime() + ttlMs);
  const toolsDigest = digestJson(toolDefinitions);
  const currentTools = new Map((params.connection.tools ?? []).map((tool) => [tool.name, tool]));
  const hasExplicitToolPolicy = (params.connection.bindings ?? [])
    .some((binding) => (binding.toolPolicies?.length ?? 0) > 0);
  let added = 0;
  let changed = 0;
  let quarantined = 0;
  const seen = new Set<string>();
  const catalogAuditRows: Array<{
    id: string;
    appAccountId: string;
    connectionId: string;
    toolId: string;
    action: string;
    status: string;
    metadataJson: Prisma.InputJsonValue;
  }> = [];

  const serverInfo = params.serverInfo && typeof params.serverInfo === "object"
    ? params.serverInfo as Record<string, unknown>
    : {};
  const identityHash = digestJson({
    name: typeof serverInfo.name === "string" ? serverInfo.name : null,
    version: typeof serverInfo.version === "string" ? serverInfo.version : null,
    endpoint: params.connection.endpointUrl,
  });
  const identityChanged = Boolean(
    params.connection.serverIdentityHash
      && params.connection.serverIdentityHash !== identityHash,
  );
  const manifestChanged = params.connection.manifestVersion !== (params.manifestVersion ?? null);
  let materialCatalogChange = toolsDigest !== params.connection.catalogHash
    || identityChanged
    || manifestChanged;
  let nextRevision = params.connection.catalogRevision || 1;

  const row = await prisma.$transaction(async (tx) => {
    const authority = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "agent_mcp_connections"
      WHERE "id" = ${params.connection.id}
        AND "app_account_id" = ${params.connection.appAccountId}
        AND "version" = ${params.connection.version}
        AND "status"::text = 'VERIFYING'
        AND "deleted_at" IS NULL
      FOR UPDATE
    `);
    if (authority.length !== 1) {
      throw new McpRuntimeError(
        "MCP_STALE_VERSION",
        "Connection changed while its MCP catalog was being discovered",
      );
    }
    for (const item of params.tools) {
      const definition = item.definition;
      const classification = item.classification;
      const existing = currentTools.get(definition.name);
      const schemaHash = mcpToolSchemaHash(definition);
      const schemaChanged = Boolean(existing && existing.schemaHash !== schemaHash);
      const nextTitle = definition.title ?? definition.annotations?.title ?? null;
      const nextDescription = definition.description ?? null;
      const metadataChanged = Boolean(
        existing
        && (existing.title !== nextTitle || existing.description !== nextDescription),
      );
      const effectiveRisk = existing
        && RISK_RANK[existing.effectiveRisk] > RISK_RANK[classification.effectiveRisk]
        ? existing.effectiveRisk
        : classification.effectiveRisk;
      const riskClassificationChanged = Boolean(
        existing
        && (
          existing.providerRisk !== classification.providerRisk
          || existing.inferredRisk !== classification.inferredRisk
          || existing.effectiveRisk !== effectiveRisk
        ),
      );
      const appearedAfterExplicitPolicy = !existing && hasExplicitToolPolicy;
      const materialChange = schemaChanged
        || riskClassificationChanged
        || identityChanged
        || manifestChanged
        || appearedAfterExplicitPolicy;
      if (materialChange) materialCatalogChange = true;
      const quarantineForChange = materialChange
        && !["READ_ONLY", "ANALYTICS_QUERY"].includes(effectiveRisk);
      const unresolvedPriorQuarantine = Boolean(
        existing?.quarantined
        && existing.schemaHash === schemaHash,
      );
      const toolQuarantined = classification.quarantined || quarantineForChange || unresolvedPriorQuarantine;
      const quarantineReason = classification.quarantined
        ? classification.reason
        : quarantineForChange
          ? "Tool schema, risk, provider policy, or server identity changed and requires explicit review."
          : unresolvedPriorQuarantine
            ? existing?.quarantineReason ?? "Tool change requires explicit review."
            : null;
      if (!existing) added += 1;
      else if (materialChange) changed += 1;
      if (toolQuarantined) quarantined += 1;
      seen.add(definition.name);
      if (existing && materialChange) {
        await tx.agentMcpToolPolicy.updateMany({
          where: { toolId: existing.id },
          data: { acknowledgedSchemaHash: null },
        });
      }
      const persistedTool = await tx.agentMcpToolDescriptor.upsert({
        where: {
          connectionId_name: {
            connectionId: params.connection.id,
            name: definition.name,
          },
        },
        create: {
          connectionId: params.connection.id,
          name: definition.name,
          title: definition.title ?? definition.annotations?.title ?? null,
          description: definition.description ?? null,
          inputSchema: jsonInput(definition.inputSchema),
          outputSchema: definition.outputSchema ? jsonInput(definition.outputSchema) : Prisma.JsonNull,
          schemaHash,
          annotationsSnapshot: definition.annotations ? jsonInput(definition.annotations) : Prisma.JsonNull,
          providerRisk: classification.providerRisk,
          inferredRisk: classification.inferredRisk,
          effectiveRisk,
          riskReason: effectiveRisk !== classification.effectiveRisk
            ? `${classification.reason} A previously observed higher risk classification remains in force.`.slice(0, 500)
            : classification.reason,
          quarantined: toolQuarantined,
          quarantineReason,
          lastSeenAt: fetchedAt,
        },
        update: {
          title: definition.title ?? definition.annotations?.title ?? null,
          description: definition.description ?? null,
          inputSchema: jsonInput(definition.inputSchema),
          outputSchema: definition.outputSchema ? jsonInput(definition.outputSchema) : Prisma.JsonNull,
          schemaHash,
          previousSchemaHash: schemaChanged ? existing?.schemaHash : undefined,
          annotationsSnapshot: definition.annotations ? jsonInput(definition.annotations) : Prisma.JsonNull,
          providerRisk: classification.providerRisk,
          inferredRisk: classification.inferredRisk,
          effectiveRisk,
          riskReason: effectiveRisk !== classification.effectiveRisk
            ? `${classification.reason} A previously observed higher risk classification remains in force.`.slice(0, 500)
            : classification.reason,
          active: true,
          quarantined: toolQuarantined,
          quarantineReason,
          lastSeenAt: fetchedAt,
          removedAt: null,
          revision: materialChange ? { increment: 1 } : undefined,
        },
      });
      if (!existing || materialChange || metadataChanged) {
        catalogAuditRows.push({
          id: `mcpa_${randomBytes(12).toString("hex")}`,
          appAccountId: params.connection.appAccountId,
          connectionId: params.connection.id,
          toolId: persistedTool.id,
          action: existing ? "CATALOG_TOOL_CHANGE" : "CATALOG_TOOL_ADD",
          status: "SUCCEEDED",
          metadataJson: jsonInput({
            previousSchemaHash: existing?.schemaHash ?? null,
            schemaHash,
            previousEffectiveRisk: existing?.effectiveRisk ?? null,
            effectiveRisk,
            schemaChanged,
            riskClassificationChanged,
            metadataChanged,
            identityChanged,
            manifestChanged,
          }) as Prisma.InputJsonValue,
        });
      }
    }
    const removed = [...currentTools.values()].filter((tool) => tool.active && !seen.has(tool.name));
    if (removed.length) {
      materialCatalogChange = true;
      await tx.agentMcpToolPolicy.updateMany({
        where: { toolId: { in: removed.map((tool) => tool.id) } },
        data: { acknowledgedSchemaHash: null },
      });
      await tx.agentMcpToolDescriptor.updateMany({
        where: { id: { in: removed.map((tool) => tool.id) } },
        data: {
          active: false,
          removedAt: fetchedAt,
          quarantined: true,
          quarantineReason: "Tool was removed from the latest provider catalog.",
          revision: { increment: 1 },
        },
      });
      for (const tool of removed) {
        catalogAuditRows.push({
          id: `mcpa_${randomBytes(12).toString("hex")}`,
          appAccountId: params.connection.appAccountId,
          connectionId: params.connection.id,
          toolId: tool.id,
          action: "CATALOG_TOOL_REMOVE",
          status: "SUCCEEDED",
          metadataJson: jsonInput({
            previousSchemaHash: tool.schemaHash,
            previousEffectiveRisk: tool.effectiveRisk,
          }) as Prisma.InputJsonValue,
        });
      }
    }
    nextRevision = materialCatalogChange
      ? params.connection.catalogRevision + 1
      : params.connection.catalogRevision || 1;
    if (catalogAuditRows.length) {
      await tx.agentMcpAuditLog.createMany({ data: catalogAuditRows });
    }
    const catalog = await tx.agentMcpCatalog.upsert({
      where: { connectionId: params.connection.id },
      create: {
        connectionId: params.connection.id,
        protocolEra: params.protocolEra ?? null,
        protocolVersion: params.protocolVersion ?? null,
        serverInfoJson: jsonInput(params.serverInfo),
        capabilitiesJson: jsonInput(params.capabilities),
        discoverJson: jsonInput(params.discover),
        instructions: params.instructions?.slice(0, 4_000) ?? null,
        toolsJson: jsonInput(toolDefinitions),
        resourcesJson: params.resources ? jsonInput(params.resources) : Prisma.JsonNull,
        resourceTemplatesJson: params.resourceTemplates ? jsonInput(params.resourceTemplates) : Prisma.JsonNull,
        promptsJson: params.prompts ? jsonInput(params.prompts) : Prisma.JsonNull,
        toolsDigest,
        endpointSnapshot: params.connection.endpointUrl,
        principalDigest,
        fetchedAt,
        validUntil,
      },
      update: {
        protocolEra: params.protocolEra ?? null,
        protocolVersion: params.protocolVersion ?? null,
        serverInfoJson: jsonInput(params.serverInfo),
        capabilitiesJson: jsonInput(params.capabilities),
        discoverJson: jsonInput(params.discover),
        instructions: params.instructions?.slice(0, 4_000) ?? null,
        toolsJson: jsonInput(toolDefinitions),
        resourcesJson: params.resources ? jsonInput(params.resources) : Prisma.JsonNull,
        resourceTemplatesJson: params.resourceTemplates ? jsonInput(params.resourceTemplates) : Prisma.JsonNull,
        promptsJson: params.prompts ? jsonInput(params.prompts) : Prisma.JsonNull,
        toolsDigest,
        endpointSnapshot: params.connection.endpointUrl,
        principalDigest,
        fetchedAt,
        validUntil,
      },
    });
    const connectionUpdated = await tx.agentMcpConnection.updateMany({
      where: {
        id: params.connection.id,
        appAccountId: params.connection.appAccountId,
        version: params.connection.version,
        deletedAt: null,
        status: "VERIFYING",
      },
      data: {
        status: params.finalConnectionStatus ?? "READY",
        statusReasonCode: null,
        statusMessage: null,
        serverName: typeof serverInfo.name === "string" ? serverInfo.name.slice(0, 160) : null,
        serverVersion: typeof serverInfo.version === "string" ? serverInfo.version.slice(0, 80) : null,
        serverIdentityHash: identityHash,
        protocolVersion: params.protocolVersion ?? null,
        manifestVersion: params.manifestVersion ?? null,
        catalogRevision: nextRevision,
        catalogHash: toolsDigest,
        lastDiscoveredAt: fetchedAt,
        lastVerifiedAt: fetchedAt,
        lastHealthyAt: fetchedAt,
        lastConnectedAt: fetchedAt,
        consecutiveFailures: 0,
        circuitOpenedAt: null,
        circuitOpenUntil: null,
        lastErrorAt: null,
        lastErrorCode: null,
        lastErrorText: null,
      },
    });
    if (connectionUpdated.count !== 1) {
      throw new McpRuntimeError(
        "MCP_STALE_VERSION",
        "Connection changed while its MCP catalog was being discovered",
      );
    }
    return catalog;
  });
  const removed = [...currentTools.values()].filter((tool) => tool.active && !seen.has(tool.name)).length;
  return {
    catalog: hydrateCatalog(row as unknown as McpCatalogRecord)!,
    changes: {
      previousRevision: params.connection.catalogRevision,
      revision: nextRevision,
      added,
      changed,
      removed,
      quarantined,
    },
  };
}

export async function expireMcpCatalog(connectionId: string): Promise<void> {
  await prisma.agentMcpCatalog.updateMany({
    where: { connectionId },
    data: { validUntil: new Date(0) },
  });
}

export async function softDeleteMcpConnection(params: {
  connectionId: string;
  appAccountId: string;
  detachBindings: boolean;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Binding creation takes the same lock, making the shared-connection guard
    // and all local revocation steps one authoritative lifecycle decision.
    const [owned] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "agent_mcp_connections"
      WHERE "id" = ${params.connectionId}
        AND "app_account_id" = ${params.appAccountId}
        AND "deleted_at" IS NULL
      FOR UPDATE
    `);
    if (!owned) {
      throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was not found");
    }
    const attachedBindings = await tx.agentMcpBinding.count({
      where: { connectionId: owned.id },
    });
    if (attachedBindings > 0 && !params.detachBindings) {
      throw new McpRuntimeError(
        "MCP_CONNECTION_IN_USE",
        "Connection is assigned to one or more agents",
      );
    }
    await tx.agentMcpBinding.deleteMany({ where: { connectionId: owned.id } });
    await tx.agentMcpCredential.deleteMany({ where: { connectionId: owned.id } });
    await tx.agentMcpOAuthTransaction.deleteMany({ where: { connectionId: owned.id } });
    // A continuation is a short-lived capability to resume an interrupted
    // remote exchange. Revoke every outstanding capability atomically with the
    // connection's bindings and credentials.
    await tx.agentMcpContinuation.deleteMany({ where: { connectionId: owned.id } });
    await tx.agentMcpConnection.update({
      where: { id: owned.id },
      data: {
        status: "DELETED",
        deletedAt: new Date(),
        disabledAt: new Date(),
        statusReasonCode: "MCP_CONNECTION_DELETED",
        statusMessage: "Connection deleted",
        version: { increment: 1 },
      },
    });
  });
}
