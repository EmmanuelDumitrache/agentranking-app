import "server-only";

import type { Client } from "@modelcontextprotocol/client";
import {
  sanitizeMcpCatalogText,
  validateMcpCatalogMetadata,
  validateMcpSupplementalCatalog,
  validateMcpToolCatalog,
} from "./catalog-validation";
import { isMcpCancellation, safeMcpErrorDetails } from "./errors";
import { redactMcpCredentialEcho } from "./credentials";
import { getMcpProviderManifest } from "./provider-registry";
import { classifyMcpTool } from "./risk";
import {
  saveMcpCatalog,
  type McpCatalogChangeSummary,
} from "./repository";
import type { McpCatalogSnapshot, McpConnectionRecord, McpToolDefinition } from "./types";

function propertyValue(value: unknown, property: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[property];
}

function resultTtlMs(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>).ttlMs;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

async function optionalCatalogCall<T>(
  connection: McpConnectionRecord,
  label: string,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    if (isMcpCancellation(error)) throw error;
    console.warn("[agent-chat] optional MCP catalog surface failed", {
      connectionId: connection.id,
      surface: label,
      error: safeMcpErrorDetails(error),
    });
    return undefined;
  }
}

export type McpDiscoveryResult = {
  catalog: McpCatalogSnapshot;
  changes: McpCatalogChangeSummary;
};

function withoutReviewedCredentialArgument(
  definition: McpToolDefinition,
  argumentName: string | undefined,
): McpToolDefinition {
  if (!argumentName) return definition;
  const schema = definition.inputSchema;
  const properties = schema.properties;
  const required = schema.required;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return definition;
  const nextProperties = { ...(properties as Record<string, unknown>) };
  delete nextProperties[argumentName];
  return {
    ...definition,
    description: [
      definition.description,
      "Provider authentication is injected securely by AgentRanking; never request or supply an API key in tool input.",
    ].filter(Boolean).join(" ").slice(0, 4_000),
    inputSchema: {
      ...schema,
      properties: nextProperties,
      ...(Array.isArray(required)
        ? { required: required.filter((name) => name !== argumentName) }
        : {}),
    },
  };
}

export async function discoverMcpCatalog(params: {
  connection: McpConnectionRecord;
  client: Client;
  signal?: AbortSignal;
  finalConnectionStatus?: "READY" | "DISABLED";
}): Promise<McpDiscoveryResult> {
  const discoveryDeadline = AbortSignal.timeout(15_000);
  const signal = params.signal
    ? AbortSignal.any([params.signal, discoveryDeadline])
    : discoveryDeadline;
  const toolsResult = await params.client.listTools(
    undefined,
    { cacheMode: "refresh", signal },
  );
  const manifest = getMcpProviderManifest(params.connection.providerKey);
  const toolArgumentAuth = params.connection.authMode === "API_KEY_TOOL_ARGUMENT"
    ? (manifest?.authOptions ?? (manifest ? [manifest.auth] : []))
      .find((auth) => auth.kind === "api-key-tool-argument")
    : undefined;
  const definitions = validateMcpToolCatalog(redactMcpCredentialEcho(
    params.connection,
    propertyValue(toolsResult, "tools"),
  ))
    .map((definition) => withoutReviewedCredentialArgument(
      definition,
      toolArgumentAuth?.kind === "api-key-tool-argument"
        ? toolArgumentAuth.argumentName
        : undefined,
    ));
  const tools = definitions.map((definition) => ({
    definition,
    classification: classifyMcpTool({ tool: definition, manifest }),
  }));
  const rawCapabilities = redactMcpCredentialEcho(
    params.connection,
    params.client.getServerCapabilities(),
  );
  const capabilities = validateMcpCatalogMetadata(
    rawCapabilities ?? {},
    "MCP server capabilities",
  );
  const capabilityObject = capabilities && typeof capabilities === "object"
    ? capabilities as Record<string, unknown>
    : {};
  const [resourcesResult, templatesResult, promptsResult] = await Promise.all([
    capabilityObject.resources
      ? optionalCatalogCall(params.connection, "resources", () =>
          params.client.listResources(undefined, { cacheMode: "refresh", signal })
            .then((result) => validateMcpSupplementalCatalog(
              redactMcpCredentialEcho(params.connection, propertyValue(result, "resources")),
              "MCP resources",
            )))
      : undefined,
    capabilityObject.resources
      ? optionalCatalogCall(params.connection, "resourceTemplates", () =>
          params.client.listResourceTemplates(undefined, { cacheMode: "refresh", signal })
            .then((result) => validateMcpSupplementalCatalog(
              redactMcpCredentialEcho(params.connection, propertyValue(result, "resourceTemplates")),
              "MCP resource templates",
            )))
      : undefined,
    capabilityObject.prompts
      ? optionalCatalogCall(params.connection, "prompts", () =>
          params.client.listPrompts(undefined, { cacheMode: "refresh", signal })
            .then((result) => validateMcpSupplementalCatalog(
              redactMcpCredentialEcho(params.connection, propertyValue(result, "prompts")),
              "MCP prompts",
            )))
      : undefined,
  ]);
  const rawServerInfo = validateMcpCatalogMetadata(
    redactMcpCredentialEcho(params.connection, params.client.getServerVersion() ?? null),
    "MCP server identity",
  );
  const serverInfoObject = rawServerInfo && typeof rawServerInfo === "object" && !Array.isArray(rawServerInfo)
    ? rawServerInfo as Record<string, unknown>
    : null;
  const serverInfo = serverInfoObject
    ? {
        ...serverInfoObject,
        name: sanitizeMcpCatalogText(
          typeof serverInfoObject.name === "string" ? serverInfoObject.name : undefined,
          160,
        ),
        version: sanitizeMcpCatalogText(
          typeof serverInfoObject.version === "string" ? serverInfoObject.version : undefined,
          80,
        ),
      }
    : null;
  const rawInstructions = params.client.getInstructions();
  return await saveMcpCatalog({
    connection: params.connection,
    protocolEra: sanitizeMcpCatalogText(params.client.getProtocolEra(), 16),
    protocolVersion: sanitizeMcpCatalogText(params.client.getNegotiatedProtocolVersion(), 32),
    serverInfo,
    capabilities,
    discover: validateMcpCatalogMetadata(
      redactMcpCredentialEcho(params.connection, params.client.getDiscoverResult() ?? null),
      "MCP initialize result",
    ),
    instructions: sanitizeMcpCatalogText(
      typeof rawInstructions === "string"
        ? redactMcpCredentialEcho(params.connection, rawInstructions)
        : undefined,
      4_000,
    ),
    tools,
    resources: resourcesResult,
    resourceTemplates: templatesResult,
    prompts: promptsResult,
    ttlMs: resultTtlMs(toolsResult),
    manifestVersion: manifest?.manifestVersion ?? null,
    finalConnectionStatus: params.finalConnectionStatus,
  });
}
