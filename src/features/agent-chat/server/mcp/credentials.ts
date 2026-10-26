import "server-only";

import { randomUUID } from "node:crypto";
import type {
  AddClientAuthentication,
  OAuthClientInformationContext,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { ClientCredentialsProvider } from "@modelcontextprotocol/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { redactExactSensitiveValues } from "@/lib/security/sensitive-data-redaction";
import {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
} from "@/lib/secret-envelope";
import type {
  McpAuthMode,
  McpConnectionRecord,
  McpCredentialRecord,
  McpOAuthSecret,
  McpStoredSecret,
} from "./types";
import {
  McpAuthenticationRequiredError,
  McpConfigurationError,
  McpRuntimeError,
  mcpErrorCode,
} from "./errors";
import { writeMcpAudit } from "./audit";
import { createHardenedMcpFetch } from "./network";
import { recordMcpOperationalEvent } from "./observability";
import { getMcpProviderManifest } from "./provider-registry";
import {
  validateCustomMcpHeaderName,
  validateMcpCredentialPrefix,
  validateMcpCredentialText,
  validatePublicMcpOAuthUrl,
} from "./endpoint-policy";

const NAMESPACE = "agent-mcp-credential";
const MAX_STORED_CREDENTIAL_BYTES = 256 * 1024;
const LEGACY_AUTH_MODE_AAD: Readonly<Partial<Record<McpAuthMode, string>>> =
  Object.freeze({
    BEARER_TOKEN: "BEARER",
    OAUTH2_AUTHORIZATION_CODE: "OAUTH",
    OAUTH2_CLIENT_CREDENTIALS: "CLIENT_CREDENTIALS",
  });
type McpCredentialDb = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "agentMcpCredential"
  | "agentMcpCatalog"
  | "agentMcpOAuthTransaction"
>;

function context(record: {
  id: string;
  appAccountId: string;
  connectionId: string;
  authMode: string;
}): readonly string[] {
  return [record.id, record.appAccountId, record.connectionId, record.authMode];
}

function stableSecretJson(secret: McpStoredSecret): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(secret);
  } catch (error) {
    throw new McpConfigurationError("MCP credential payload is not valid JSON", { cause: error });
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_CREDENTIAL_BYTES) {
    throw new McpConfigurationError("MCP credential payload exceeds the encrypted storage limit");
  }
  return serialized;
}

function oauthAuthorizationContextId(secret: McpOAuthSecret): string {
  return secret.authorizationContextId?.trim() || randomUUID();
}

function normalizedOAuthUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function oauthManifestPolicy(connection: McpConnectionRecord): {
  issuer?: string;
  resource?: string;
  tokenEndpoint?: string;
  scopes?: readonly string[];
} {
  const manifest = getMcpProviderManifest(connection.providerKey);
  const oauth = (manifest?.authOptions ?? (manifest ? [manifest.auth] : []))
    .find((auth) => auth.kind === "oauth2");
  return oauth?.kind === "oauth2"
    ? {
        issuer: oauth.issuer,
        resource: oauth.resource,
        tokenEndpoint: oauth.tokenEndpoint,
        scopes: oauth.scopes,
      }
    : {};
}

export function mcpExpectedOAuthResourceUrl(connection: McpConnectionRecord): string {
  return oauthManifestPolicy(connection).resource ?? connection.endpointUrl;
}

function assertOAuthDiscoveryPolicy(
  connection: McpConnectionRecord,
  state: OAuthDiscoveryState,
): void {
  const policy = oauthManifestPolicy(connection);
  if (policy.issuer) {
    const expected = normalizedOAuthUrl(policy.issuer);
    const actual = normalizedOAuthUrl(state.authorizationServerUrl);
    const metadata = state.authorizationServerMetadata as { issuer?: unknown } | undefined;
    const metadataIssuer = typeof metadata?.issuer === "string"
      ? normalizedOAuthUrl(metadata.issuer)
      : actual;
    if (actual !== expected || metadataIssuer !== expected) {
      throw new McpConfigurationError("OAuth authorization issuer does not match the reviewed provider manifest");
    }
  }
  if (policy.resource) {
    const metadata = state.resourceMetadata as { resource?: unknown } | undefined;
    if (typeof metadata?.resource === "string") {
      const expected = normalizedOAuthUrl(policy.resource);
      const actual = normalizedOAuthUrl(metadata.resource);
      if (actual !== expected) {
        throw new McpConfigurationError("OAuth resource audience does not match the reviewed provider manifest");
      }
    }
  }
  if (policy.tokenEndpoint) {
    const metadata = state.authorizationServerMetadata as { token_endpoint?: unknown } | undefined;
    if (
      typeof metadata?.token_endpoint !== "string"
      || normalizedOAuthUrl(metadata.token_endpoint) !== normalizedOAuthUrl(policy.tokenEndpoint)
    ) {
      throw new McpConfigurationError(
        "OAuth token endpoint does not match the reviewed provider manifest",
      );
    }
  }
}

function assertOAuthTokensPolicy(
  connection: McpConnectionRecord,
  tokens: StoredOAuthTokens,
): void {
  const policy = oauthManifestPolicy(connection);
  const stampedIssuer = (tokens as StoredOAuthTokens & { issuer?: unknown }).issuer;
  if (
    policy.issuer
    && typeof stampedIssuer === "string"
    && normalizedOAuthUrl(stampedIssuer) !== normalizedOAuthUrl(policy.issuer)
  ) {
    throw new McpConfigurationError("OAuth token issuer does not match the reviewed provider manifest");
  }
  if (policy.scopes?.length && typeof tokens.scope === "string") {
    const allowed = new Set([...policy.scopes, "offline_access"]);
    const granted = tokens.scope.split(/\s+/).filter(Boolean);
    if (
      granted.some((scope) => !allowed.has(scope))
      || policy.scopes.some((scope) => !granted.includes(scope))
    ) {
      throw new McpConfigurationError("OAuth token scope does not match the reviewed provider manifest");
    }
  }
}

function normalizeStoredSecret(secret: McpStoredSecret): McpStoredSecret {
  if (secret.kind !== "oauth") return secret;
  return {
    ...secret,
    authorizationContextId: oauthAuthorizationContextId(secret),
  };
}

function principalFingerprint(secret: McpStoredSecret): string {
  if (secret.kind !== "oauth") {
    return fingerprintSecret(NAMESPACE, stableSecretJson(secret));
  }
  return fingerprintSecret(
    NAMESPACE,
    JSON.stringify({
      kind: "oauth",
      authorizationContextId: oauthAuthorizationContextId(secret),
    }),
  );
}

function parseStoredSecret(
  credential: McpCredentialRecord,
  authMode: McpAuthMode,
): McpStoredSecret {
  let value: unknown;
  try {
    const legacyMode = LEGACY_AUTH_MODE_AAD[authMode];
    const candidates = [authMode, legacyMode].filter((mode): mode is string => Boolean(mode));
    let plaintext: string | null = null;
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        plaintext = decryptSecret(
          credential.encryptedSecret,
          credential.encryptionKeyId,
          credential.encryptionVersion,
          {
            namespace: NAMESPACE,
            context: context({ ...credential, authMode: candidate }),
          },
        );
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (plaintext === null) throw lastError;
    value = JSON.parse(plaintext);
  } catch (error) {
    throw new McpConfigurationError("MCP credential could not be decrypted", { cause: error });
  }
  if (!value || typeof value !== "object" || !("kind" in value)) {
    throw new McpConfigurationError("MCP credential payload is malformed");
  }
  return value as McpStoredSecret;
}

type SaveMcpSecretParams = {
  connectionId: string;
  appAccountId: string;
  authMode: McpAuthMode;
  secret: McpStoredSecret;
  expectedCredentialFingerprint?: string;
};

async function saveMcpSecretWithDb(
  params: SaveMcpSecretParams,
  db: McpCredentialDb,
  requireStoredAuthMode: boolean,
): Promise<void> {
  const authority = requireStoredAuthMode
    ? await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "agent_mcp_connections"
        WHERE "id" = ${params.connectionId}
          AND "app_account_id" = ${params.appAccountId}
          AND "auth_mode"::text = ${params.authMode}
          AND "deleted_at" IS NULL
        FOR UPDATE
      `)
    : await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "agent_mcp_connections"
        WHERE "id" = ${params.connectionId}
          AND "app_account_id" = ${params.appAccountId}
          AND "deleted_at" IS NULL
        FOR UPDATE
      `);
  if (authority.length !== 1) {
    throw new McpAuthenticationRequiredError(
      "MCP credential authority changed before it could be persisted",
    );
  }
  if (params.expectedCredentialFingerprint) {
    const credentialAuthority = await db.$queryRaw<Array<{ fingerprint: string }>>(Prisma.sql`
      SELECT "fingerprint"
      FROM "agent_mcp_credentials"
      WHERE "connection_id" = ${params.connectionId}
        AND "app_account_id" = ${params.appAccountId}
      FOR UPDATE
    `);
    if (
      credentialAuthority.length !== 1
      || credentialAuthority[0]?.fingerprint !== params.expectedCredentialFingerprint
    ) {
      throw new McpAuthenticationRequiredError(
        "MCP credential principal changed before it could be persisted",
      );
    }
  }
  const existing = await db.agentMcpCredential.findUnique({
    where: { connectionId: params.connectionId },
    select: { id: true, fingerprint: true },
  });
  const id = existing?.id ?? randomUUID();
  const normalizedSecret = normalizeStoredSecret(params.secret);
  const plaintext = stableSecretJson(normalizedSecret);
  const encrypted = encryptSecret(plaintext, {
    namespace: NAMESPACE,
    context: context({
      id,
      appAccountId: params.appAccountId,
      connectionId: params.connectionId,
      authMode: params.authMode,
    }),
  });
  const fingerprint = principalFingerprint(normalizedSecret);
  await db.agentMcpCredential.upsert({
    where: { connectionId: params.connectionId },
    create: {
      id,
      connectionId: params.connectionId,
      appAccountId: params.appAccountId,
      ...encrypted,
      fingerprint,
    },
    update: {
      appAccountId: params.appAccountId,
      ...encrypted,
      fingerprint,
    },
  });
  if (existing?.fingerprint && existing.fingerprint !== fingerprint) {
    await db.agentMcpCatalog.updateMany({
      where: { connectionId: params.connectionId },
      data: { validUntil: new Date(0) },
    });
  }
}

export async function saveMcpSecret(
  params: SaveMcpSecretParams,
  db?: McpCredentialDb,
): Promise<void> {
  if (db) {
    await saveMcpSecretWithDb(params, db, false);
    return;
  }
  await prisma.$transaction(async (tx) => {
    // Standalone OAuth/token persistence must prove the current auth mode and
    // hold the connection lock through the credential upsert. This prevents a
    // callback from recreating credentials after auth rotation or soft delete.
    await saveMcpSecretWithDb(params, tx, true);
  });
}

export async function deleteMcpSecret(
  connectionId: string,
  db: McpCredentialDb,
): Promise<void> {
  await db.agentMcpCredential.deleteMany({ where: { connectionId } });
}

/**
 * Makes an administrator reauthentication command locally atomic. Remote
 * token revocation is intentionally best-effort, but local OAuth authority,
 * pending states, catalog eligibility, lifecycle status, and optimistic
 * version change together or roll back together.
 */
export async function forceMcpConnectionReauthentication(
  connection: McpConnectionRecord,
): Promise<{ oauthRevocation: McpOAuthRevocationOutcome }> {
  let secret: McpStoredSecret | null = null;
  if (connection.authMode === "OAUTH2_AUTHORIZATION_CODE") {
    try {
      secret = loadMcpStoredSecret(connection);
    } catch {
      // Administrator recovery must still be able to replace an unreadable or
      // missing OAuth envelope with a fresh, empty authorization context.
    }
  }
  await prisma.$transaction(async (tx) => {
    if (connection.authMode === "OAUTH2_AUTHORIZATION_CODE") {
      await saveMcpSecret({
        connectionId: connection.id,
        appAccountId: connection.appAccountId,
        authMode: connection.authMode,
        secret: {
          kind: "oauth",
          authorizationContextId: randomUUID(),
          ...(secret?.kind === "oauth" && secret.discoveryState
            ? { discoveryState: secret.discoveryState }
            : {}),
          resourceUrl: mcpExpectedOAuthResourceUrl(connection),
        },
      }, tx);
    }
    const updated = await tx.agentMcpConnection.updateMany({
      where: {
        id: connection.id,
        appAccountId: connection.appAccountId,
        version: connection.version,
        deletedAt: null,
      },
      data: {
        status: "REAUTH_REQUIRED",
        statusReasonCode: "MCP_ADMIN_REAUTH_REQUIRED",
        statusMessage: "An administrator requires this connection to be reauthenticated",
        // Reauthentication never grants runtime access. Preserve an account
        // owner's independent global suspension, including legacy rows that
        // represented it only with the DISABLED lifecycle status.
        disabledAt: connection.disabledAt
          ?? (connection.status === "DISABLED" ? new Date() : undefined),
        consecutiveFailures: 0,
        circuitOpenedAt: null,
        circuitOpenUntil: null,
        lastErrorAt: new Date(),
        lastErrorCode: "MCP_ADMIN_REAUTH_REQUIRED",
        lastErrorText: "An administrator requires this connection to be reauthenticated",
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new McpRuntimeError(
        "MCP_STALE_VERSION",
        "Connection changed while administrator reauthentication was being applied",
      );
    }
    await tx.agentMcpCatalog.updateMany({
      where: { connectionId: connection.id },
      data: { validUntil: new Date(0) },
    });
    await tx.agentMcpOAuthTransaction.deleteMany({
      where: { connectionId: connection.id },
    });
    await tx.agentMcpContinuation.deleteMany({
      where: { connectionId: connection.id },
    });
  });
  // Local authority is the security boundary. Revoke the credential snapshot
  // only after the versioned local transition commits; otherwise a stale admin
  // action could revoke a connection whose compare-and-swap ultimately fails.
  const oauthRevocation = await attemptMcpOAuthTokenRevocation(connection);
  return { oauthRevocation };
}

/**
 * Starts an explicit user reauthorization from a fresh OAuth principal while
 * retaining only reviewed discovery and dynamic-client registration data.
 * Rotating the authorization context invalidates in-flight callbacks, runtime
 * client cache partitions, catalogs, and resumable calls before a new browser
 * grant can begin.
 */
export async function beginMcpOAuthReauthorization(params: {
  connection: McpConnectionRecord;
  actorProfileId?: number;
}): Promise<{ oauthRevocation: McpOAuthRevocationOutcome }> {
  const { connection } = params;
  if (connection.authMode !== "OAUTH2_AUTHORIZATION_CODE") {
    throw new McpConfigurationError("MCP connection is not configured for OAuth");
  }
  let previous: McpOAuthSecret | null = null;
  try {
    const loaded = loadMcpStoredSecret(connection);
    if (loaded?.kind === "oauth") previous = loaded;
  } catch {
    // An unreadable envelope must not prevent the user from replacing it.
  }
  const next: McpOAuthSecret = {
    kind: "oauth",
    authorizationContextId: randomUUID(),
    ...(previous?.clientInformation ? { clientInformation: previous.clientInformation } : {}),
    ...(previous?.discoveryState ? { discoveryState: previous.discoveryState } : {}),
    resourceUrl: mcpExpectedOAuthResourceUrl(connection),
  };
  await prisma.$transaction(async (tx) => {
    const authority = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "agent_mcp_connections"
      WHERE "id" = ${connection.id}
        AND "app_account_id" = ${connection.appAccountId}
        AND "auth_mode" = 'OAUTH2_AUTHORIZATION_CODE'
        AND "version" = ${connection.version}
        AND "deleted_at" IS NULL
      FOR UPDATE
    `);
    if (authority.length !== 1) {
      throw new McpRuntimeError(
        "MCP_STALE_VERSION",
        "Connection changed before OAuth reauthorization could begin",
      );
    }
    await saveMcpSecretWithDb({
      connectionId: connection.id,
      appAccountId: connection.appAccountId,
      authMode: "OAUTH2_AUTHORIZATION_CODE",
      secret: next,
      expectedCredentialFingerprint: connection.credential?.fingerprint,
    }, tx, true);
    await tx.agentMcpOAuthTransaction.deleteMany({ where: { connectionId: connection.id } });
    await tx.agentMcpContinuation.deleteMany({ where: { connectionId: connection.id } });
    await writeMcpAudit({
      appAccountId: connection.appAccountId,
      actorProfileId: params.actorProfileId,
      connectionId: connection.id,
      action: "OAUTH_REAUTHENTICATE",
      status: "SUCCEEDED",
      metadata: { authMode: "OAUTH2_AUTHORIZATION_CODE" },
    }, tx);
  });
  const oauthRevocation = previous?.tokens
    ? await attemptMcpOAuthTokenRevocation(connection)
    : "not_applicable";
  recordMcpOperationalEvent({
    event: "oauth",
    outcome: "reauth_started",
    providerKey: connection.providerKey,
  });
  return { oauthRevocation };
}

export type McpOAuthRevocationOutcome =
  | "not_applicable"
  | "not_supported"
  | "succeeded"
  | "failed";

/**
 * Best-effort RFC 7009 revocation. Local disable/delete remains authoritative:
 * this helper never throws, never reads an upstream body, and has a short
 * deadline. The endpoint still passes the pinned MCP egress policy.
 */
export async function attemptMcpOAuthTokenRevocation(
  connection: McpConnectionRecord,
): Promise<McpOAuthRevocationOutcome> {
  if (connection.authMode !== "OAUTH2_AUTHORIZATION_CODE" || !connection.credential) {
    return "not_applicable";
  }
  try {
    const secret = loadMcpStoredSecret(connection);
    if (secret?.kind !== "oauth") return "not_applicable";
    const discovery = secret.discoveryState as OAuthDiscoveryState | undefined;
    if (!discovery) return "not_supported";
    assertOAuthDiscoveryPolicy(connection, discovery);
    const metadata = discovery.authorizationServerMetadata as {
      revocation_endpoint?: unknown;
      revocation_endpoint_auth_methods_supported?: unknown;
    } | undefined;
    if (typeof metadata?.revocation_endpoint !== "string") return "not_supported";
    const revocationUrl = validatePublicMcpOAuthUrl({
      url: metadata.revocation_endpoint,
      label: "OAuth revocation endpoint",
    }).url;
    const policy = oauthManifestPolicy(connection);
    if (policy.issuer && new URL(revocationUrl).origin !== new URL(policy.issuer).origin) {
      return "failed";
    }
    const tokens = secret.tokens as {
      access_token?: unknown;
      refresh_token?: unknown;
    } | undefined;
    const token = typeof tokens?.refresh_token === "string" && tokens.refresh_token
      ? tokens.refresh_token
      : typeof tokens?.access_token === "string" && tokens.access_token
        ? tokens.access_token
        : null;
    if (!token) return "not_applicable";
    const client = secret.clientInformation as {
      client_id?: unknown;
      client_secret?: unknown;
      token_endpoint_auth_method?: unknown;
    } | undefined;
    const clientId = typeof client?.client_id === "string" ? client.client_id : null;
    const clientSecret = typeof client?.client_secret === "string" ? client.client_secret : null;
    const advertisedMethods = Array.isArray(metadata.revocation_endpoint_auth_methods_supported)
      ? metadata.revocation_endpoint_auth_methods_supported.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const configuredMethod = typeof client?.token_endpoint_auth_method === "string"
      ? client.token_endpoint_auth_method
      : null;
    const authMethod = configuredMethod
      ?? (advertisedMethods.includes("client_secret_basic")
        ? "client_secret_basic"
        : advertisedMethods.includes("client_secret_post")
          ? "client_secret_post"
          : clientSecret
            ? "client_secret_basic"
            : "none");
    const body = new URLSearchParams({
      token,
      token_type_hint: typeof tokens?.refresh_token === "string"
        ? "refresh_token"
        : "access_token",
    });
    const headers = new Headers({
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    if (clientId && clientSecret && authMethod === "client_secret_basic") {
      headers.set(
        "Authorization",
        `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`, "utf8").toString("base64")}`,
      );
    } else {
      if (clientId) body.set("client_id", clientId);
      if (clientSecret && authMethod === "client_secret_post") {
        body.set("client_secret", clientSecret);
      }
    }
    const response = await createHardenedMcpFetch({
      rejectAuthenticatedCrossOriginRedirects: true,
      maxResponseBytes: 64 * 1024,
    })(revocationUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(5_000),
      redirect: "manual",
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok ? "succeeded" : "failed";
  } catch {
    return "failed";
  }
}

export function loadMcpStoredSecret(connection: McpConnectionRecord): McpStoredSecret | null {
  if (!connection.credential) return null;
  return parseStoredSecret(connection.credential, connection.authMode);
}

export function redactMcpCredentialEcho<T>(
  connection: McpConnectionRecord,
  value: T,
): T {
  const secret = loadMcpStoredSecret(connection);
  if (!secret) return value;
  const values: string[] = [];
  if (secret.kind === "bearer") values.push(secret.token);
  if (secret.kind === "api-key-header") {
    values.push(secret.value);
    if (secret.prefix) values.push(`${secret.prefix}${secret.value}`);
  }
  if (secret.kind === "api-key-query" || secret.kind === "api-key-tool-argument") {
    values.push(secret.value);
  }
  if (secret.kind === "client_credentials") values.push(secret.clientSecret);
  if (secret.kind === "oauth") {
    if (secret.codeVerifier) values.push(secret.codeVerifier);
    const tokens = secret.tokens ?? {};
    for (const key of ["access_token", "refresh_token", "id_token", "accessToken", "refreshToken", "idToken"]) {
      const token = tokens[key];
      if (typeof token === "string") values.push(token);
    }
    const clientSecret = secret.clientInformation?.client_secret
      ?? secret.clientInformation?.clientSecret;
    if (typeof clientSecret === "string") values.push(clientSecret);
  }
  return redactExactSensitiveValues(value, values);
}

export async function configureBearerCredential(params: {
  connectionId: string;
  appAccountId: string;
  token: string;
}, db?: McpCredentialDb): Promise<void> {
  const token = params.token.trim();
  if (!token) throw new McpConfigurationError("Bearer token cannot be empty");
  await saveMcpSecret({
    ...params,
    authMode: "BEARER_TOKEN",
    secret: { kind: "bearer", token },
  }, db);
}

export async function configureApiKeyHeaderCredential(params: {
  connectionId: string;
  appAccountId: string;
  headerName: string;
  value: string;
  prefix?: string;
  reviewedHeader?: boolean;
}, db?: McpCredentialDb): Promise<void> {
  const headerName = params.reviewedHeader
    ? validateMcpCredentialText(params.headerName, "API-key header name", 128)
    : validateCustomMcpHeaderName(params.headerName);
  const value = validateMcpCredentialText(params.value, "API key");
  const prefix = validateMcpCredentialPrefix(params.prefix);
  await saveMcpSecret({
    connectionId: params.connectionId,
    appAccountId: params.appAccountId,
    authMode: "API_KEY_HEADER",
    secret: { kind: "api-key-header", headerName, value, prefix },
  }, db);
}

export async function configureApiKeyPlacementCredential(params: {
  connectionId: string;
  appAccountId: string;
  authMode: "API_KEY_QUERY" | "API_KEY_TOOL_ARGUMENT";
  name: string;
  value: string;
}, db?: McpCredentialDb): Promise<void> {
  const name = validateMcpCredentialText(params.name, "API-key placement name", 128);
  const value = validateMcpCredentialText(params.value, "API key");
  await saveMcpSecret({
    connectionId: params.connectionId,
    appAccountId: params.appAccountId,
    authMode: params.authMode,
    secret: {
      kind: params.authMode === "API_KEY_QUERY"
        ? "api-key-query"
        : "api-key-tool-argument",
      name,
      value,
    },
  }, db);
}

export async function configureClientCredentials(params: {
  connectionId: string;
  appAccountId: string;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  scope?: string;
  expectedIssuer: string;
}, db?: McpCredentialDb): Promise<void> {
  const clientId = params.clientId.trim();
  const clientSecret = params.clientSecret.trim();
  if (!clientId || !clientSecret) {
    throw new McpConfigurationError("OAuth client ID and client secret are required");
  }
  const tokenEndpoint = validatePublicMcpOAuthUrl({
    url: params.tokenEndpoint,
    label: "OAuth token endpoint",
  }).url;
  const expectedIssuer = validatePublicMcpOAuthUrl({
    url: params.expectedIssuer,
    label: "OAuth issuer",
  }).url.replace(/\/$/, "");
  await saveMcpSecret({
    connectionId: params.connectionId,
    appAccountId: params.appAccountId,
    authMode: "OAUTH2_CLIENT_CREDENTIALS",
    secret: {
      kind: "client_credentials",
      clientId,
      clientSecret,
      tokenEndpoint,
      scope: params.scope?.trim() || undefined,
      expectedIssuer,
    },
  }, db);
}

export async function ensureOAuthCredential(params: {
  connectionId: string;
  appAccountId: string;
  existing?: McpConnectionRecord["credential"];
}, db?: McpCredentialDb): Promise<void> {
  if (params.existing) return;
  await saveMcpSecret({
    connectionId: params.connectionId,
    appAccountId: params.appAccountId,
    authMode: "OAUTH2_AUTHORIZATION_CODE",
    secret: { kind: "oauth", authorizationContextId: randomUUID() },
  }, db);
}

export type PersistedOAuthProvider = OAuthClientProvider & {
  readonly authorizationUrl: URL | null;
};

export function createPersistedOAuthProvider(params: {
  connection: McpConnectionRecord;
  redirectUrl: URL;
  state?: string;
}): PersistedOAuthProvider {
  const initial = loadMcpStoredSecret(params.connection);
  if (!initial || initial.kind !== "oauth") {
    throw new McpAuthenticationRequiredError("OAuth has not been configured for this MCP server");
  }
  let secret: McpOAuthSecret = {
    ...initial,
    authorizationContextId: oauthAuthorizationContextId(initial),
  };
  let authorityFingerprint = params.connection.credential?.fingerprint;
  if (!authorityFingerprint) {
    throw new McpAuthenticationRequiredError("OAuth credential authority is unavailable");
  }
  let authorizationUrl: URL | null = null;

  const reload = async (): Promise<McpOAuthSecret> => {
    const credential = await prisma.agentMcpCredential.findUnique({
      where: { connectionId: params.connection.id },
    });
    if (!credential) {
      throw new McpAuthenticationRequiredError("OAuth credentials are no longer available");
    }
    if (credential.fingerprint !== authorityFingerprint) {
      throw new McpAuthenticationRequiredError(
        "OAuth authorization context changed; start a new authorization flow",
      );
    }
    const current = parseStoredSecret(
      credential as unknown as McpCredentialRecord,
      params.connection.authMode,
    );
    if (current.kind !== "oauth") {
      throw new McpConfigurationError("Stored MCP OAuth credential has the wrong format");
    }
    secret = {
      ...current,
      authorizationContextId: oauthAuthorizationContextId(current),
    };
    return secret;
  };

  const persist = async (authenticationAction?: string) => {
    const save = {
      connectionId: params.connection.id,
      appAccountId: params.connection.appAccountId,
      authMode: "OAUTH2_AUTHORIZATION_CODE" as const,
      secret,
      expectedCredentialFingerprint: authorityFingerprint,
    };
    if (authenticationAction) {
      await prisma.$transaction(async (tx) => {
        await saveMcpSecretWithDb(save, tx, true);
        await writeMcpAudit({
          appAccountId: params.connection.appAccountId,
          connectionId: params.connection.id,
          action: authenticationAction,
          status: "SUCCEEDED",
          metadata: { authMode: "OAUTH2_AUTHORIZATION_CODE" },
        }, tx);
      });
    } else {
      await saveMcpSecret(save);
    }
    authorityFingerprint = principalFingerprint(normalizeStoredSecret(secret));
  };

  const provider: OAuthClientProvider & { authorizationUrl: URL | null } = {
    get redirectUrl() {
      return params.redirectUrl;
    },
    get clientMetadata() {
      const reviewedScope = oauthManifestPolicy(params.connection).scopes?.join(" ");
      return {
        redirect_uris: [params.redirectUrl.toString()],
        client_name: "AgentRanking Agent Chat",
        application_type: "web",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...(reviewedScope ? { scope: reviewedScope } : {}),
      };
    },
    state: params.state ? async () => params.state! : undefined,
    async clientInformation(_ctx?: OAuthClientInformationContext) {
      return (await reload()).clientInformation as StoredOAuthClientInformation | undefined;
    },
    async saveClientInformation(
      clientInformation: StoredOAuthClientInformation,
      _ctx?: OAuthClientInformationContext,
    ) {
      secret = {
        ...await reload(),
        clientInformation: clientInformation as unknown as Record<string, unknown>,
      };
      await persist();
    },
    async tokens(_ctx?: OAuthClientInformationContext) {
      return (await reload()).tokens as StoredOAuthTokens | undefined;
    },
    async saveTokens(tokens: StoredOAuthTokens, _ctx?: OAuthClientInformationContext) {
      assertOAuthTokensPolicy(params.connection, tokens);
      const current = await reload();
      const authenticationAction = current.tokens
        ? "OAUTH_TOKEN_REFRESH"
        : "OAUTH_TOKEN_ISSUED";
      secret = {
        ...current,
        tokens: tokens as unknown as Record<string, unknown>,
        tokensSavedAt: new Date().toISOString(),
      };
      try {
        await persist(authenticationAction);
        recordMcpOperationalEvent({
          event: "oauth",
          outcome: authenticationAction === "OAUTH_TOKEN_REFRESH" ? "refreshed" : "issued",
          providerKey: params.connection.providerKey,
        });
      } catch (error) {
        recordMcpOperationalEvent({
          event: "oauth",
          outcome: "failed",
          providerKey: params.connection.providerKey,
          reason: mcpErrorCode(error),
        });
        await writeMcpAudit({
          appAccountId: params.connection.appAccountId,
          connectionId: params.connection.id,
          action: authenticationAction,
          status: "FAILED",
          reasonCode: mcpErrorCode(error),
          metadata: { authMode: "OAUTH2_AUTHORIZATION_CODE" },
        }).catch(() => undefined);
        throw error;
      }
    },
    async redirectToAuthorization(url: URL) {
      authorizationUrl = new URL(url);
      provider.authorizationUrl = authorizationUrl;
    },
    async saveCodeVerifier(codeVerifier: string) {
      secret = { ...await reload(), codeVerifier };
      await persist();
    },
    async codeVerifier() {
      const current = await reload();
      if (!current.codeVerifier) {
        throw new McpConfigurationError("OAuth PKCE verifier is unavailable");
      }
      return current.codeVerifier;
    },
    async invalidateCredentials(scope) {
      const current = scope === "all" ? null : await reload();
      switch (scope) {
        case "all":
          secret = { kind: "oauth", authorizationContextId: randomUUID() };
          break;
        case "client":
          secret = {
            ...current!,
            authorizationContextId: randomUUID(),
            clientInformation: undefined,
          };
          break;
        case "tokens":
          secret = {
            ...current!,
            authorizationContextId: randomUUID(),
            tokens: undefined,
            tokensSavedAt: undefined,
          };
          break;
        case "verifier":
          secret = { ...current!, codeVerifier: undefined };
          break;
        case "discovery":
          secret = { ...current!, discoveryState: undefined, resourceUrl: undefined };
          break;
      }
      await persist();
    },
    async saveDiscoveryState(state: OAuthDiscoveryState) {
      assertOAuthDiscoveryPolicy(params.connection, state);
      secret = {
        ...await reload(),
        discoveryState: state as unknown as Record<string, unknown>,
      };
      await persist();
    },
    async discoveryState() {
      const state = (await reload()).discoveryState as OAuthDiscoveryState | undefined;
      if (state) assertOAuthDiscoveryPolicy(params.connection, state);
      return state;
    },
    async saveResourceUrl(resourceUrl: string) {
      const expected = mcpExpectedOAuthResourceUrl(params.connection);
      if (normalizedOAuthUrl(resourceUrl) !== normalizedOAuthUrl(expected)) {
        throw new McpConfigurationError("OAuth resource URL does not match the bound MCP resource");
      }
      secret = { ...await reload(), resourceUrl: normalizedOAuthUrl(expected) };
      await persist();
    },
    async resourceUrl() {
      return (await reload()).resourceUrl;
    },
    authorizationUrl,
  };
  return provider as PersistedOAuthProvider;
}

export function buildMcpAuthProvider(connection: McpConnectionRecord): unknown {
  if (connection.authMode === "NONE") return undefined;
  const secret = loadMcpStoredSecret(connection);
  if (!secret) {
    throw new McpAuthenticationRequiredError("Credentials are required for this MCP server");
  }

  if (connection.authMode === "BEARER_TOKEN") {
    if (secret.kind !== "bearer" || !secret.token) {
      throw new McpConfigurationError("Stored MCP bearer credential has the wrong format");
    }
    return { token: async () => secret.token };
  }
  if (connection.authMode === "API_KEY_HEADER" && secret.kind !== "api-key-header") {
    throw new McpConfigurationError("Stored MCP API-key header credential has the wrong format");
  }
  if (connection.authMode === "API_KEY_QUERY" && secret.kind !== "api-key-query") {
    throw new McpConfigurationError("Stored MCP API-key query credential has the wrong format");
  }
  if (
    connection.authMode === "API_KEY_TOOL_ARGUMENT"
    && secret.kind !== "api-key-tool-argument"
  ) {
    throw new McpConfigurationError("Stored MCP tool-argument credential has the wrong format");
  }
  if (["API_KEY_HEADER", "API_KEY_QUERY", "API_KEY_TOOL_ARGUMENT"].includes(connection.authMode)) {
    return undefined;
  }
  if (connection.authMode === "OAUTH2_CLIENT_CREDENTIALS") {
    if (
      secret.kind !== "client_credentials"
      || typeof secret.tokenEndpoint !== "string"
      || !secret.tokenEndpoint.trim()
      || typeof secret.expectedIssuer !== "string"
      || !secret.expectedIssuer.trim()
    ) {
      throw new McpAuthenticationRequiredError(
        "OAuth client credentials must be re-entered with a reviewed token endpoint and issuer",
      );
    }
    if (!secret.clientId || !secret.clientSecret) {
      throw new McpConfigurationError("Stored MCP client credential has the wrong format");
    }
    const clientId = secret.clientId;
    const clientSecret = secret.clientSecret;
    const tokenEndpoint = secret.tokenEndpoint;
    const provider = new ClientCredentialsProvider({
      clientId,
      clientSecret,
      scope: secret.scope,
      expectedIssuer: secret.expectedIssuer,
      clientName: "AgentRanking Agent Chat",
    });
    const addClientAuthentication: AddClientAuthentication = (headers, _body, url) => {
      if (normalizedOAuthUrl(url.toString()) !== normalizedOAuthUrl(tokenEndpoint)) {
        throw new McpConfigurationError(
          "Discovered OAuth token endpoint does not match the configured credential endpoint",
        );
      }
      // ClientCredentialsProvider advertises client_secret_basic. Supplying a
      // custom hook lets us retain that authentication method while pinning the
      // exact reviewed token endpoint before any machine credential is attached.
      const encoded = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    };
    return Object.assign(provider, { addClientAuthentication });
  }
  if (connection.authMode === "OAUTH2_AUTHORIZATION_CODE") {
    throw new McpAuthenticationRequiredError(
      "Interactive OAuth requires the persisted OAuth provider with a callback URL",
    );
  }
  throw new McpConfigurationError(`Unsupported MCP auth mode: ${connection.authMode}`);
}

export type ResolvedCredentialPolicy = {
  expectedHeaderName?: string;
};

export function applyMcpCredential(
  headers: Headers,
  credential: McpStoredSecret,
  policy: ResolvedCredentialPolicy,
): void {
  if (credential.kind !== "api-key-header") return;
  const expected = policy.expectedHeaderName;
  if (expected && credential.headerName.toLowerCase() !== expected.toLowerCase()) {
    throw new McpConfigurationError("Stored API-key header does not match the reviewed provider manifest");
  }
  const value = credential.prefix
    ? `${credential.prefix}${credential.value}`
    : credential.value;
  if (/\r|\n|[\u0000-\u001f\u007f]/.test(value)) {
    throw new McpConfigurationError("Stored API-key value contains invalid control characters");
  }
  headers.set(expected ?? credential.headerName, value);
}

export function buildMcpRequestHeaders(params: {
  connection: McpConnectionRecord;
  expectedHeaderName?: string;
}): { headers: Headers; sensitiveHeaderNames: readonly string[] } {
  const headers = new Headers();
  if (params.connection.authMode !== "API_KEY_HEADER") {
    return { headers, sensitiveHeaderNames: [] };
  }
  const secret = loadMcpStoredSecret(params.connection);
  if (!secret || secret.kind !== "api-key-header") {
    throw new McpAuthenticationRequiredError("An API key is required for this MCP server");
  }
  applyMcpCredential(headers, secret, {
    expectedHeaderName: params.expectedHeaderName,
  });
  return {
    headers,
    sensitiveHeaderNames: [params.expectedHeaderName ?? secret.headerName],
  };
}

export function applyMcpQueryCredential(params: {
  connection: McpConnectionRecord;
  endpoint: URL;
  expectedParameterName?: string;
}): { endpoint: URL; sensitiveQueryParameterNames: readonly string[] } {
  if (params.connection.authMode !== "API_KEY_QUERY") {
    return { endpoint: params.endpoint, sensitiveQueryParameterNames: [] };
  }
  const secret = loadMcpStoredSecret(params.connection);
  if (!secret || secret.kind !== "api-key-query") {
    throw new McpAuthenticationRequiredError("An API key is required for this MCP server");
  }
  if (params.expectedParameterName && secret.name !== params.expectedParameterName) {
    throw new McpConfigurationError("Stored API-key query placement does not match the reviewed provider manifest");
  }
  const endpoint = new URL(params.endpoint);
  endpoint.searchParams.set(params.expectedParameterName ?? secret.name, secret.value);
  return {
    endpoint,
    sensitiveQueryParameterNames: [params.expectedParameterName ?? secret.name],
  };
}

export function applyMcpToolArgumentCredential(params: {
  connection: McpConnectionRecord;
  argumentsValue: Record<string, unknown>;
  expectedArgumentName?: string;
}): Record<string, unknown> {
  if (params.connection.authMode !== "API_KEY_TOOL_ARGUMENT") return params.argumentsValue;
  const secret = loadMcpStoredSecret(params.connection);
  if (!secret || secret.kind !== "api-key-tool-argument") {
    throw new McpAuthenticationRequiredError("An API key is required for this MCP server");
  }
  if (params.expectedArgumentName && secret.name !== params.expectedArgumentName) {
    throw new McpConfigurationError("Stored API-key tool placement does not match the reviewed provider manifest");
  }
  return {
    ...params.argumentsValue,
    [params.expectedArgumentName ?? secret.name]: secret.value,
  };
}

export function mcpCredentialSummary(connection: McpConnectionRecord) {
  const configured = connection.authMode === "NONE" || Boolean(connection.credential);
  const label = {
    NONE: "No authentication",
    BEARER_TOKEN: "Bearer token",
    API_KEY_HEADER: "API key header",
    API_KEY_QUERY: "API key (secure URL injection)",
    API_KEY_TOOL_ARGUMENT: "API key (secure tool injection)",
    OAUTH2_AUTHORIZATION_CODE: "OAuth authorization",
    OAUTH2_CLIENT_CREDENTIALS: "OAuth client credentials",
  }[connection.authMode];
  let expiresAt: string | null = null;
  if (connection.authMode === "OAUTH2_AUTHORIZATION_CODE" && connection.credential) {
    try {
      const secret = loadMcpStoredSecret(connection);
      const oauthSecret = secret?.kind === "oauth" ? secret : null;
      const tokens = oauthSecret?.tokens;
      const absolute = tokens?.expires_at ?? tokens?.expiresAt ?? tokens?.expiration;
      if (typeof absolute === "string" || typeof absolute === "number") {
        const numeric = typeof absolute === "number" ? absolute : Number(absolute);
        const date = Number.isFinite(numeric)
          ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000)
          : new Date(String(absolute));
        if (!Number.isNaN(date.getTime())) expiresAt = date.toISOString();
      } else if (typeof tokens?.expires_in === "number" && oauthSecret?.tokensSavedAt) {
        const savedAt = new Date(oauthSecret.tokensSavedAt).getTime();
        if (Number.isFinite(savedAt)) {
          expiresAt = new Date(savedAt + Math.max(0, tokens.expires_in) * 1_000).toISOString();
        }
      }
    } catch {
      // A summary must never expose decryption details. Runtime/auth paths will
      // surface the stable credential error when the connection is used.
    }
  }
  return {
    kind: connection.authMode,
    authMode: connection.authMode,
    configured,
    label,
    fingerprintSuffix: connection.credential?.fingerprint.slice(-4) ?? null,
    maskedIdentifier: connection.credential
      ? `configured · ${connection.credential.fingerprint.slice(-4)}`
      : undefined,
    reauthRequired: connection.status === "REAUTH_REQUIRED",
    expiresAt,
  };
}
