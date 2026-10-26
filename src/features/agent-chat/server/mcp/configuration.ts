import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  configureApiKeyHeaderCredential,
  configureApiKeyPlacementCredential,
  configureBearerCredential,
  configureClientCredentials,
  deleteMcpSecret,
  ensureOAuthCredential,
} from "./credentials";
import {
  normalizeMcpEndpoint,
  validateCustomMcpHeaderName,
  validateMcpCredentialPrefix,
  validateMcpCredentialText,
  validatePublicMcpOAuthUrl,
} from "./endpoint-policy";
import { McpConfigurationError, McpRuntimeError } from "./errors";
import {
  getMcpProviderManifest,
  mcpProviderAuthMode,
  resolveMcpProviderEndpoint,
} from "./provider-registry";
import {
  getMcpConnection,
  hydrateCatalog,
  isCatalogReusableForConnection,
  isCatalogWithinMaximumStaleAge,
} from "./repository";
import type {
  McpAuthMode,
  McpConnectionRecord,
  McpTransportMode,
} from "./types";

export type McpConnectionPatch = {
  displayName?: string;
  endpointUrl?: string;
  disabled?: boolean;
  authMode?: McpAuthMode;
  transportMode?: McpTransportMode;
  apiKey?: string;
  apiKeyHeaderName?: string;
  apiKeyPrefix?: string;
  bearerToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  scope?: string;
  expectedIssuer?: string;
  expectedVersion?: number;
};

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new McpConfigurationError(`${label} is required`);
  return normalized;
}

function authAllowedForManifest(
  authMode: McpAuthMode,
  connection: McpConnectionRecord,
): boolean {
  const manifest = getMcpProviderManifest(connection.providerKey);
  if (!manifest) return !["API_KEY_QUERY", "API_KEY_TOOL_ARGUMENT"].includes(authMode);
  const authModes = (manifest.authOptions ?? [manifest.auth]).map(mcpProviderAuthMode);
  return authModes.includes(authMode);
}

export async function configureMcpConnection(params: {
  connection: McpConnectionRecord;
  patch: McpConnectionPatch;
}): Promise<McpConnectionRecord> {
  if (
    params.patch.expectedVersion !== undefined
    && params.patch.expectedVersion !== params.connection.version
  ) {
    throw new McpRuntimeError("MCP_STALE_VERSION", "Connection was changed in another session");
  }
  const manifest = getMcpProviderManifest(params.connection.providerKey);
  if (
    params.connection.providerKey
    && !manifest
    && [
      params.patch.endpointUrl,
      params.patch.authMode,
      params.patch.transportMode,
      params.patch.apiKey,
      params.patch.apiKeyHeaderName,
      params.patch.apiKeyPrefix,
      params.patch.bearerToken,
      params.patch.clientId,
      params.patch.clientSecret,
      params.patch.tokenEndpoint,
      params.patch.scope,
      params.patch.expectedIssuer,
    ].some((value) => value !== undefined)
  ) {
    throw new McpRuntimeError(
      "MCP_POLICY_BLOCKED",
      "This MCP provider no longer has an executable platform manifest",
    );
  }
  const desiredAuth = params.patch.authMode ?? params.connection.authMode;
  if (!authAllowedForManifest(desiredAuth, params.connection)) {
    throw new McpConfigurationError("Authentication mode is not allowed by the reviewed provider manifest");
  }
  const credentialFields = {
    apiKey: params.patch.apiKey,
    apiKeyHeaderName: params.patch.apiKeyHeaderName,
    apiKeyPrefix: params.patch.apiKeyPrefix,
    bearerToken: params.patch.bearerToken,
    clientId: params.patch.clientId,
    clientSecret: params.patch.clientSecret,
    tokenEndpoint: params.patch.tokenEndpoint,
    scope: params.patch.scope,
    expectedIssuer: params.patch.expectedIssuer,
  };
  const allowedCredentialFields: Record<McpAuthMode, ReadonlySet<keyof typeof credentialFields>> = {
    NONE: new Set<keyof typeof credentialFields>(),
    BEARER_TOKEN: new Set<keyof typeof credentialFields>(["bearerToken"]),
    API_KEY_HEADER: new Set<keyof typeof credentialFields>([
      "apiKey",
      "apiKeyHeaderName",
      "apiKeyPrefix",
    ]),
    API_KEY_QUERY: new Set<keyof typeof credentialFields>(["apiKey"]),
    API_KEY_TOOL_ARGUMENT: new Set<keyof typeof credentialFields>(["apiKey"]),
    OAUTH2_AUTHORIZATION_CODE: new Set<keyof typeof credentialFields>(),
    OAUTH2_CLIENT_CREDENTIALS: new Set<keyof typeof credentialFields>([
      "clientId",
      "clientSecret",
      "tokenEndpoint",
      "scope",
      "expectedIssuer",
    ]),
  };
  const unexpectedCredentialField = Object.entries(credentialFields)
    .find(([key, value]) => value !== undefined
      && !allowedCredentialFields[desiredAuth].has(key as keyof typeof credentialFields));
  if (unexpectedCredentialField) {
    throw new McpConfigurationError(
      `Credential field ${unexpectedCredentialField[0]} is not valid for ${desiredAuth}`,
    );
  }
  if (
    desiredAuth === "API_KEY_HEADER"
    && (params.patch.apiKeyHeaderName !== undefined || params.patch.apiKeyPrefix !== undefined)
    && !params.patch.apiKey?.trim()
  ) {
    throw new McpConfigurationError("Changing API-key header settings requires a replacement API key");
  }
  const clientCredentialFieldSupplied = [
    params.patch.clientId,
    params.patch.clientSecret,
    params.patch.tokenEndpoint,
    params.patch.scope,
    params.patch.expectedIssuer,
  ].some((value) => value !== undefined);
  if (
    desiredAuth === "OAUTH2_CLIENT_CREDENTIALS"
    && clientCredentialFieldSupplied
    && (!params.patch.clientId?.trim() || !params.patch.clientSecret?.trim())
  ) {
    throw new McpConfigurationError(
      "Changing OAuth client credential settings requires both a client ID and client secret",
    );
  }
  if (params.patch.transportMode) {
    const requestedTransport = params.patch.transportMode === "LEGACY_SSE"
      ? "legacy-sse"
      : "streamable-http";
    if (manifest && !manifest.transports.includes(requestedTransport)) {
      throw new McpConfigurationError("Transport is not allowed by the reviewed provider manifest");
    }
  }
  const reviewedEndpoint = params.patch.authMode && manifest
    ? resolveMcpProviderEndpoint(manifest, desiredAuth)
    : null;
  const endpointValue = params.patch.endpointUrl
    ?? (reviewedEndpoint?.kind === "fixed" ? reviewedEndpoint.url : undefined);
  const endpoint = endpointValue === undefined
    ? null
    : normalizeMcpEndpoint({
        endpoint: endpointValue,
        manifest,
      });
  if (
    params.connection.providerKey
    && params.patch.endpointUrl !== undefined
    && endpoint
    && manifest?.endpoint.kind === "fixed"
  ) {
    throw new McpConfigurationError("Fixed catalog provider endpoints cannot be changed");
  }
  const displayName = params.patch.displayName?.trim();
  if (displayName !== undefined && (!displayName || displayName.length > 120)) {
    throw new McpConfigurationError("Connection display name must be between 1 and 120 characters");
  }

  const authChanged = desiredAuth !== params.connection.authMode;
  const credentialChanged = Boolean(
    params.patch.apiKey?.trim()
    || params.patch.bearerToken?.trim()
    || params.patch.clientId?.trim()
    || params.patch.clientSecret?.trim(),
  );
  const transportChanged = params.patch.transportMode !== undefined
    && params.patch.transportMode !== params.connection.transportMode;
  const endpointChanged = Boolean(endpoint && endpoint.url !== params.connection.endpointUrl);
  const remoteChanged = authChanged || credentialChanged || transportChanged || endpointChanged;

  // Validate replacement material before deleting an existing envelope. This
  // keeps a rejected auth-mode change from destroying the last valid secret.
  if (authChanged && desiredAuth === "BEARER_TOKEN") {
    validateMcpCredentialText(required(params.patch.bearerToken, "Bearer token"), "Bearer token");
  }
  if (authChanged && desiredAuth === "API_KEY_HEADER") {
    validateMcpCredentialText(required(params.patch.apiKey, "API key"), "API key");
  }
  if (
    authChanged
    && ["API_KEY_QUERY", "API_KEY_TOOL_ARGUMENT"].includes(desiredAuth)
  ) {
    validateMcpCredentialText(required(params.patch.apiKey, "API key"), "API key");
  }
  if (authChanged && desiredAuth === "OAUTH2_CLIENT_CREDENTIALS") {
    validateMcpCredentialText(required(params.patch.clientId, "OAuth client ID"), "OAuth client ID", 4_096);
    validateMcpCredentialText(required(params.patch.clientSecret, "OAuth client secret"), "OAuth client secret");
    const reviewedClientAuth = (manifest?.authOptions ?? (manifest ? [manifest.auth] : []))
      .find((auth) => auth.kind === "client-credentials");
    validatePublicMcpOAuthUrl({
      url: reviewedClientAuth?.kind === "client-credentials"
        ? reviewedClientAuth.tokenEndpoint
        : required(params.patch.tokenEndpoint, "OAuth token endpoint"),
      label: "OAuth token endpoint",
    });
    validatePublicMcpOAuthUrl({
      url: reviewedClientAuth?.kind === "client-credentials"
        ? reviewedClientAuth.issuer
        : required(params.patch.expectedIssuer, "OAuth issuer"),
      label: "OAuth issuer",
    });
  }
  if (desiredAuth === "API_KEY_HEADER" && (authChanged || params.patch.apiKey)) {
    const reviewedHeader = (manifest?.authOptions ?? (manifest ? [manifest.auth] : []))
      .find((auth) => auth.kind === "api-key-header");
    if (!reviewedHeader) validateCustomMcpHeaderName(required(params.patch.apiKeyHeaderName, "API-key header name"));
    validateMcpCredentialText(required(params.patch.apiKey, "API key"), "API key");
    validateMcpCredentialPrefix(params.patch.apiKeyPrefix);
  }

  const persistedCatalog = hydrateCatalog(params.connection.catalog);
  const canResumeFromCatalog = isCatalogReusableForConnection(persistedCatalog, params.connection)
    && isCatalogWithinMaximumStaleAge(persistedCatalog)
    && (!manifest || params.connection.manifestVersion === manifest.manifestVersion);
  const preserveDisabled = params.connection.status === "DISABLED"
    && params.patch.disabled !== false;
  const preserveBlocked = params.connection.status === "BLOCKED";
  const preserveRecoveryState = preserveBlocked || (
    ["REAUTH_REQUIRED", "INVALID"].includes(params.connection.status)
    && params.patch.disabled !== undefined
    && !remoteChanged
  );
  const status = preserveRecoveryState
    ? undefined
    : params.patch.disabled === true
      ? "DISABLED"
      : preserveDisabled
        ? undefined
        : remoteChanged
          ? desiredAuth === "OAUTH2_AUTHORIZATION_CODE" ? "AUTH_PENDING" : "DRAFT"
          : params.patch.disabled === false && params.connection.status === "DISABLED"
            ? canResumeFromCatalog ? "READY" : "DRAFT"
      : undefined;
  await prisma.$transaction(async (tx) => {
    // All credential and lifecycle mutations take the connection lock first.
    // This shares an ordering with binding creation, continuation persistence,
    // and deletion and avoids both resurrection races and lock inversion.
    const authority = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "agent_mcp_connections"
      WHERE "id" = ${params.connection.id}
        AND "app_account_id" = ${params.connection.appAccountId}
        AND "version" = ${params.connection.version}
        AND "deleted_at" IS NULL
      FOR UPDATE
    `);
    if (authority.length !== 1) {
      throw new McpRuntimeError("MCP_STALE_VERSION", "Connection was changed in another session");
    }
    if (authChanged) await deleteMcpSecret(params.connection.id, tx);

    if (desiredAuth === "NONE") {
      await deleteMcpSecret(params.connection.id, tx);
    } else if (desiredAuth === "BEARER_TOKEN" && (authChanged || params.patch.bearerToken)) {
      await configureBearerCredential({
        connectionId: params.connection.id,
        appAccountId: params.connection.appAccountId,
        token: required(params.patch.bearerToken, "Bearer token"),
      }, tx);
    } else if (desiredAuth === "API_KEY_HEADER" && (authChanged || params.patch.apiKey)) {
      const manifestAuth = (manifest?.authOptions ?? (manifest ? [manifest.auth] : []))
        .find((auth) => auth.kind === "api-key-header");
      const headerName = manifestAuth?.kind === "api-key-header"
        ? manifestAuth.headerName
        : required(params.patch.apiKeyHeaderName, "API-key header name");
      const prefix = manifestAuth?.kind === "api-key-header"
        ? manifestAuth.prefix
        : params.patch.apiKeyPrefix;
      await configureApiKeyHeaderCredential({
        connectionId: params.connection.id,
        appAccountId: params.connection.appAccountId,
        headerName,
        value: required(params.patch.apiKey, "API key"),
        prefix,
        reviewedHeader: Boolean(manifestAuth),
      }, tx);
    } else if (
      ["API_KEY_QUERY", "API_KEY_TOOL_ARGUMENT"].includes(desiredAuth)
      && (authChanged || params.patch.apiKey)
    ) {
      const manifestAuth = (manifest?.authOptions ?? (manifest ? [manifest.auth] : []))
        .find((auth) => mcpProviderAuthMode(auth) === desiredAuth);
      const name = manifestAuth?.kind === "api-key-query"
        ? manifestAuth.parameterName
        : manifestAuth?.kind === "api-key-tool-argument"
          ? manifestAuth.argumentName
          : null;
      if (!name) {
        throw new McpConfigurationError("Secure API-key placement requires a reviewed provider manifest");
      }
      await configureApiKeyPlacementCredential({
        connectionId: params.connection.id,
        appAccountId: params.connection.appAccountId,
        authMode: desiredAuth as "API_KEY_QUERY" | "API_KEY_TOOL_ARGUMENT",
        name,
        value: required(params.patch.apiKey, "API key"),
      }, tx);
    } else if (
      desiredAuth === "OAUTH2_CLIENT_CREDENTIALS"
      && (authChanged || params.patch.clientId || params.patch.clientSecret)
    ) {
      const manifestAuth = (manifest?.authOptions ?? (manifest ? [manifest.auth] : []))
        .find((auth) => auth.kind === "client-credentials");
      const tokenEndpoint = manifestAuth?.kind === "client-credentials"
        ? manifestAuth.tokenEndpoint
        : required(params.patch.tokenEndpoint, "OAuth token endpoint");
      const expectedIssuer = manifestAuth?.kind === "client-credentials"
        ? manifestAuth.issuer
        : required(params.patch.expectedIssuer, "OAuth issuer");
      await configureClientCredentials({
        connectionId: params.connection.id,
        appAccountId: params.connection.appAccountId,
        clientId: required(params.patch.clientId, "OAuth client ID"),
        clientSecret: required(params.patch.clientSecret, "OAuth client secret"),
        tokenEndpoint,
        scope: manifestAuth?.kind === "client-credentials"
          ? manifestAuth.scopes?.join(" ")
          : params.patch.scope,
        expectedIssuer,
      }, tx);
    } else if (desiredAuth === "OAUTH2_AUTHORIZATION_CODE") {
      await ensureOAuthCredential({
        connectionId: params.connection.id,
        appAccountId: params.connection.appAccountId,
        existing: authChanged ? undefined : params.connection.credential,
      }, tx);
    }

    const updated = await tx.agentMcpConnection.updateMany({
      where: {
        id: params.connection.id,
        appAccountId: params.connection.appAccountId,
        version: params.connection.version,
        deletedAt: null,
      },
      data: {
        displayName,
        endpointUrl: endpoint?.url,
        endpointOrigin: endpoint?.origin,
        endpointHost: endpoint?.host,
        endpointFingerprint: endpoint?.fingerprint,
        authMode: params.patch.authMode,
        transportMode: params.patch.transportMode,
        lastSuccessfulTransport: transportChanged ? null : undefined,
        status,
        // Global suspension is an independent security fact. Keep it even when
        // the lifecycle status must continue to expose BLOCKED,
        // REAUTH_REQUIRED, or INVALID so an enable action cannot erase the
        // recovery requirement.
        disabledAt: params.patch.disabled === true
          ? new Date()
          : params.patch.disabled === false
            ? null
            : undefined,
        statusReasonCode: status ? null : undefined,
        statusMessage: status ? null : undefined,
        lastErrorAt: remoteChanged ? null : undefined,
        lastErrorCode: remoteChanged ? null : undefined,
        lastErrorText: remoteChanged ? null : undefined,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new McpRuntimeError("MCP_STALE_VERSION", "Connection was changed in another session");
    }
    if (remoteChanged) {
      await tx.agentMcpCatalog.updateMany({
        where: { connectionId: params.connection.id },
        data: { validUntil: new Date(0) },
      });
    }
    if (remoteChanged || params.patch.disabled === true) {
      await tx.agentMcpOAuthTransaction.deleteMany({
        where: { connectionId: params.connection.id },
      });
      await tx.agentMcpContinuation.deleteMany({
        where: { connectionId: params.connection.id },
      });
    }
  });
  const connection = await getMcpConnection({
    appAccountId: params.connection.appAccountId,
    connectionId: params.connection.id,
  });
  if (!connection) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection disappeared while updating");
  return connection;
}
