import "server-only";

import { prisma } from "@/lib/db";
import { writeMcpAudit } from "./audit";
import { upsertAgentMcpBinding } from "./binding-repository";
import { configureMcpConnection } from "./configuration";
import { verifyAndDiscoverMcpConnection } from "./discovery-service";
import { normalizeMcpEndpoint } from "./endpoint-policy";
import {
  McpConfigurationError,
  McpRuntimeError,
  mcpConnectionStatusForError,
  mcpErrorCode,
  safeMcpErrorDetails,
} from "./errors";
import {
  getMcpProviderManifest,
  mcpProviderAuthMode,
  providerAllowsNewConnection,
  resolveMcpProviderEndpoint,
} from "./provider-registry";
import { assertMcpNewConnectionAllowed } from "./platform-policy";
import {
  createMcpConnectionRecord,
  getMcpConnection,
  updateMcpConnectionStatus,
} from "./repository";
import type { McpAuthMode, McpTransportMode } from "./types";

export type CreateMcpCredentialInput =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | {
      kind: "api-key-header";
      value: string;
      headerName?: string;
      prefix?: string;
    }
  | { kind: "api-key-query"; value: string }
  | { kind: "api-key-tool-argument"; value: string }
  | { kind: "oauth2-authorization-code" }
  | {
      kind: "oauth2-client-credentials";
      clientId: string;
      clientSecret: string;
      tokenEndpoint?: string;
      scope?: string;
      expectedIssuer?: string;
    };

function authMode(credential: CreateMcpCredentialInput): McpAuthMode {
  if (credential.kind === "none") return "NONE";
  if (credential.kind === "bearer") return "BEARER_TOKEN";
  if (credential.kind === "api-key-header") return "API_KEY_HEADER";
  if (credential.kind === "api-key-query") return "API_KEY_QUERY";
  if (credential.kind === "api-key-tool-argument") return "API_KEY_TOOL_ARGUMENT";
  if (credential.kind === "oauth2-authorization-code") return "OAUTH2_AUTHORIZATION_CODE";
  return "OAUTH2_CLIENT_CREDENTIALS";
}

export async function createMcpConnection(params: {
  appAccountId: string;
  actorProfileId?: number;
  providerKey?: string | null;
  displayName: string;
  endpointUrl?: string;
  credential: CreateMcpCredentialInput;
  transportMode?: McpTransportMode;
  enableForAgentId?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<{
  connection: NonNullable<Awaited<ReturnType<typeof getMcpConnection>>>;
  created: boolean;
  verification: { ok: boolean; code?: string; message?: string };
  assignment?: { ok: boolean; code?: string; message?: string };
}> {
  const providerKey = params.providerKey?.trim().toLowerCase() || null;
  const manifest = getMcpProviderManifest(providerKey);
  if (providerKey && !manifest) {
    throw new McpConfigurationError("Unknown MCP provider key");
  }
  if (manifest && !providerAllowsNewConnection(manifest)) {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Provider is not admitted for remote connections");
  }
  const mode = authMode(params.credential);
  const reviewedEndpoint = manifest ? resolveMcpProviderEndpoint(manifest, mode) : null;
  const endpointValue = reviewedEndpoint?.kind === "fixed"
    ? reviewedEndpoint.url
    : params.endpointUrl?.trim();
  if (!endpointValue) throw new McpConfigurationError("Custom MCP endpoint is required");
  const endpoint = normalizeMcpEndpoint({ endpoint: endpointValue, manifest });
  await assertMcpNewConnectionAllowed({
    appAccountId: params.appAccountId,
    providerKey,
    endpointOrigin: endpoint.origin,
  });
  const displayName = params.displayName.trim();
  if (!displayName || displayName.length > 120) {
    throw new McpConfigurationError("Connection display name must be between 1 and 120 characters");
  }
  if (manifest) {
    const allowedModes = (manifest.authOptions ?? [manifest.auth]).map(mcpProviderAuthMode);
    if (!allowedModes.includes(mode)) {
      throw new McpConfigurationError("Authentication mode is not allowed by the reviewed provider manifest");
    }
  } else if (["API_KEY_QUERY", "API_KEY_TOOL_ARGUMENT"].includes(mode)) {
    throw new McpConfigurationError(
      "Secure query or tool-argument credentials require a reviewed provider manifest",
    );
  }
  if (
    mode === "OAUTH2_CLIENT_CREDENTIALS"
    && !manifest
    && params.credential.kind === "oauth2-client-credentials"
    && (!params.credential.tokenEndpoint?.trim() || !params.credential.expectedIssuer?.trim())
  ) {
    throw new McpConfigurationError(
      "Custom client credentials require an exact OAuth token endpoint and issuer",
    );
  }
  if (params.enableForAgentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: params.enableForAgentId, ownerAccountId: params.appAccountId },
      select: { id: true },
    });
    if (!agent) {
      throw new McpRuntimeError(
        "MCP_CONNECTION_OWNERSHIP_MISMATCH",
        "Agent and MCP connection must belong to the same account",
      );
    }
  }
  const requestedTransport = params.transportMode
    ?? (manifest?.transports[0] === "legacy-sse" ? "LEGACY_SSE" : "STREAMABLE_HTTP");
  const transportName = requestedTransport === "LEGACY_SSE" ? "legacy-sse" : "streamable-http";
  if (manifest && !manifest.transports.includes(transportName)) {
    throw new McpConfigurationError("Selected transport is not supported by this provider manifest");
  }
  const created = await createMcpConnectionRecord({
    appAccountId: params.appAccountId,
    providerKey,
    displayName,
    endpoint,
    authMode: mode,
    transportMode: requestedTransport,
    manifestVersion: manifest?.manifestVersion ?? null,
    idempotencyKey: params.idempotencyKey,
  });
  if (!created.created) {
    if (
      created.connection.providerKey !== providerKey
      || created.connection.endpointUrl !== endpoint.url
      || created.connection.authMode !== mode
      || created.connection.transportMode !== requestedTransport
      || created.connection.displayName !== displayName
    ) {
      throw new McpRuntimeError(
        "MCP_STALE_VERSION",
        "Idempotency key was already used for different MCP connection parameters",
      );
    }
  }
  let connection = created.connection;
  try {
    // A retry may observe the durable connection after an interruption but
    // before its credential transaction. Resume that exact workflow without
    // overwriting a credential that was already committed and remains
    // intentionally write-only.
    if (created.created || (mode !== "NONE" && !connection.credential)) {
      connection = await configureMcpConnection({
        connection,
        patch: params.credential.kind === "none"
          ? {}
          : params.credential.kind === "bearer"
            ? { bearerToken: params.credential.token }
            : params.credential.kind === "api-key-header"
              ? {
                  apiKey: params.credential.value,
                  apiKeyHeaderName: params.credential.headerName,
                  apiKeyPrefix: params.credential.prefix,
                }
              : params.credential.kind === "api-key-query"
                || params.credential.kind === "api-key-tool-argument"
                ? { apiKey: params.credential.value }
              : params.credential.kind === "oauth2-client-credentials"
                ? {
                    clientId: params.credential.clientId,
                    clientSecret: params.credential.clientSecret,
                    tokenEndpoint: params.credential.tokenEndpoint,
                    scope: params.credential.scope,
                    expectedIssuer: params.credential.expectedIssuer,
                  }
                : {},
      });
    }
    await writeMcpAudit({
      appAccountId: params.appAccountId,
      actorProfileId: params.actorProfileId,
      connectionId: connection.id,
      action: "CONNECTION_CREATE",
      status: "SUCCEEDED",
      metadata: {
        providerKey,
        endpointOrigin: endpoint.origin,
        authMode: mode,
        retryCount: created.created ? 0 : 1,
      },
    });
    if (mode === "OAUTH2_AUTHORIZATION_CODE" && connection.status !== "READY") {
      return {
        connection,
        created: created.created,
        verification: {
          ok: false,
          code: "MCP_AUTH_REQUIRED",
          message: "Continue with OAuth authorization.",
        },
      };
    }
    let catalogRevision = connection.catalogRevision;
    if (connection.status !== "READY") {
      const result = await verifyAndDiscoverMcpConnection({
        appAccountId: params.appAccountId,
        actorProfileId: params.actorProfileId,
        connectionId: connection.id,
        signal: params.signal,
      });
      catalogRevision = result.changes.revision;
      connection = (await getMcpConnection({
        appAccountId: params.appAccountId,
        connectionId: connection.id,
      }))!;
    }
    let assignment: { ok: boolean; code?: string; message?: string } | undefined;
    if (params.enableForAgentId) {
      try {
        const binding = await upsertAgentMcpBinding({
          appAccountId: params.appAccountId,
          agentDbId: params.enableForAgentId,
          connectionId: connection.id,
          enabled: true,
        });
        await writeMcpAudit({
          appAccountId: params.appAccountId,
          actorProfileId: params.actorProfileId,
          agentDbId: params.enableForAgentId,
          bindingId: binding.id,
          connectionId: connection.id,
          action: "BINDING_ENABLE",
          status: "SUCCEEDED",
          metadata: { createdWithConnection: true },
        });
        assignment = { ok: true };
      } catch (error) {
        assignment = {
          ok: false,
          code: mcpErrorCode(error),
          message: safeMcpErrorDetails(error).message,
        };
        await writeMcpAudit({
          appAccountId: params.appAccountId,
          actorProfileId: params.actorProfileId,
          agentDbId: params.enableForAgentId,
          connectionId: connection.id,
          action: "BINDING_ENABLE",
          status: "FAILED",
          reasonCode: assignment.code,
          metadata: { createdWithConnection: true },
        }).catch(() => undefined);
      }
    }
    return {
      connection,
      created: created.created,
      verification: {
        ok: true,
        message: `Discovered catalog revision ${catalogRevision}.`,
      },
      assignment,
    };
  } catch (error) {
    const failureStatus = mcpConnectionStatusForError(error);
    await updateMcpConnectionStatus({
      connectionId: connection.id,
      status: ["REAUTH_REQUIRED", "BLOCKED", "INVALID"].includes(failureStatus)
        ? failureStatus
        : connection.catalogRevision > 0
          ? "DEGRADED"
          : "INVALID",
      reasonCode: mcpErrorCode(error),
      error,
      expectedVersion: connection.version,
      expectedStatuses: ["DRAFT", "AUTH_PENDING", "VERIFYING", "READY", "DEGRADED", "INVALID"],
    }).catch(() => undefined);
    await writeMcpAudit({
      appAccountId: params.appAccountId,
      actorProfileId: params.actorProfileId,
      connectionId: connection.id,
      action: "CONNECTION_CREATE",
      status: "FAILED",
      reasonCode: mcpErrorCode(error),
      metadata: { providerKey, endpointOrigin: endpoint.origin },
    }).catch(() => undefined);
    const refreshed = await getMcpConnection({
      appAccountId: params.appAccountId,
      connectionId: connection.id,
    });
    if (!refreshed) throw error;
    return {
      connection: refreshed,
      created: created.created,
      verification: {
        ok: false,
        code: mcpErrorCode(error),
        message: safeMcpErrorDetails(error).message,
      },
    };
  }
}
