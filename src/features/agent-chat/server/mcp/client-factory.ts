import "server-only";

import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { getAppProductSiteUrl } from "@/lib/site-url";
import { createHardenedMcpFetch, type McpFetch } from "./network";
import {
  buildMcpAuthProvider,
  buildMcpRequestHeaders,
  applyMcpQueryCredential,
  createPersistedOAuthProvider,
  type PersistedOAuthProvider,
} from "./credentials";
import { normalizeMcpEndpoint } from "./endpoint-policy";
import {
  McpConfigurationError,
  McpOAuthAuthorizationRequiredError,
  McpRuntimeError,
  McpUnavailableError,
  safeMcpErrorDetails,
} from "./errors";
import { withObservedMcpOperation } from "./observability";
import {
  getMcpProviderManifest,
  mcpProviderAuthMode,
  providerAllowsExistingConnection,
  resolveMcpProviderEndpoint,
} from "./provider-registry";
import { withMcpConnectionSingleFlight } from "./reliability";
import { MCP_DISCOVERY_LIMITS } from "./catalog-validation";
import {
  expireMcpCatalog,
  hydrateCatalog,
  isCatalogReusableForConnection,
  recordMcpSuccessfulTransport,
} from "./repository";
import type { McpConnectionRecord, McpResolvedTransport } from "./types";

const CONNECT_TIMEOUT_MS = 10_000;
const OAUTH_TOKEN_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

type McpTransport = StreamableHTTPClientTransport | SSEClientTransport;

export type ConnectedMcpClient = {
  client: Client;
  transport: McpTransport;
  transportKind: McpResolvedTransport;
  oauthProvider: PersistedOAuthProvider | null;
  close(): Promise<void>;
};

export function mcpOAuthRedirectUrl(connection: McpConnectionRecord): URL {
  return new URL(
    `/api/dashboard/mcp/connections/${encodeURIComponent(connection.id)}/oauth/callback`,
    getAppProductSiteUrl(),
  );
}

function cachePartition(connection: McpConnectionRecord): string {
  return [
    connection.id,
    connection.appAccountId,
    connection.endpointFingerprint,
    connection.transportMode,
    String(connection.manifestVersion ?? "custom"),
    connection.credential?.fingerprint ?? "anonymous",
  ].join(":");
}

function buildPrior(connection: McpConnectionRecord): unknown | undefined {
  const catalog = hydrateCatalog(connection.catalog);
  if (!isCatalogReusableForConnection(catalog, connection)) return undefined;
  if (
    catalog.protocolEra === "modern"
    && catalog.discover
    && typeof catalog.discover === "object"
  ) {
    return { kind: "modern", discover: catalog.discover };
  }
  if (catalog.protocolEra === "legacy") return { kind: "legacy" };
  return undefined;
}

function buildAuth(connection: McpConnectionRecord, oauthState?: string): {
  authProvider: unknown;
  oauthProvider: PersistedOAuthProvider | null;
} {
  if (connection.authMode !== "OAUTH2_AUTHORIZATION_CODE") {
    return { authProvider: buildMcpAuthProvider(connection), oauthProvider: null };
  }
  const oauthProvider = createPersistedOAuthProvider({
    connection,
    redirectUrl: mcpOAuthRedirectUrl(connection),
    state: oauthState,
  });
  return { authProvider: oauthProvider, oauthProvider };
}

function createClient(connection: McpConnectionRecord): Client {
  const expire = () => {
    void expireMcpCatalog(connection.id).catch((error) => {
      console.warn("[agent-chat] failed to expire MCP catalog after list_changed", {
        connectionId: connection.id,
        error: safeMcpErrorDetails(error),
      });
    });
  };
  const client = new Client(
    { name: "agentranking-agent-chat", version: "1.0.0" },
    {
      capabilities: {
        elicitation: { form: {}, url: {} },
      },
      versionNegotiation: {
        mode: "auto",
        probe: { timeoutMs: 5_000, maxRetries: 0 },
      },
      cachePartition: cachePartition(connection),
      defaultCacheTtlMs: DEFAULT_CACHE_TTL_MS,
      listMaxPages: MCP_DISCOVERY_LIMITS.maxPages,
      inputRequired: { autoFulfill: false, maxRounds: 4 },
      listChanged: {
        tools: { onChanged: expire },
        prompts: { onChanged: expire },
        resources: { onChanged: expire },
      },
    },
  );
  // Legacy elicitation cannot suspend an in-flight JSON-RPC request across a
  // browser turn. Modern servers use durable input_required instead.
  client.setRequestHandler("elicitation/create", async () => ({ action: "cancel" }));
  return client;
}

async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise;
  if (signal.aborted) throw signal.reason ?? new Error("MCP operation cancelled");
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("MCP operation cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function isOAuthTokenRequest(request: Request): Promise<boolean> {
  if (request.method.toUpperCase() !== "POST") return false;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) return false;
  const declaredBytes = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredBytes) && declaredBytes > 64 * 1024) {
    throw new McpConfigurationError("OAuth token request exceeds the platform byte limit");
  }
  let body: string;
  try {
    body = await request.clone().text();
  } catch {
    // Fail toward serialization for an OAuth form request whose body cannot be
    // inspected, preventing an ambiguous token exchange from stampeding.
    return true;
  }
  if (Buffer.byteLength(body, "utf8") > 64 * 1024) {
    throw new McpConfigurationError("OAuth token request exceeds the platform byte limit");
  }
  return new URLSearchParams(body).has("grant_type");
}

function withOAuthTokenSingleFlight(
  connection: McpConnectionRecord,
  fetch: McpFetch,
): McpFetch {
  if (!["OAUTH2_AUTHORIZATION_CODE", "OAUTH2_CLIENT_CREDENTIALS"].includes(connection.authMode)) {
    return fetch;
  }
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!(await isOAuthTokenRequest(request))) return await fetch(request);
    return await withMcpConnectionSingleFlight(connection.id, "oauth-token", async (leaseSignal) => {
      const signal = AbortSignal.any([request.signal, leaseSignal]);
      return await fetch(new Request(request, { signal }));
    });
  }) as McpFetch;
}

function createTransport(params: {
  connection: McpConnectionRecord;
  kind: McpResolvedTransport;
  oauthState?: string;
}): {
  transport: McpTransport;
  oauthProvider: PersistedOAuthProvider | null;
} {
  const manifest = getMcpProviderManifest(params.connection.providerKey);
  if (!providerAllowsExistingConnection(manifest, params.connection.providerKey)) {
    throw new McpRuntimeError(
      "MCP_POLICY_BLOCKED",
      "This MCP provider no longer has an executable platform manifest",
    );
  }
  const normalized = normalizeMcpEndpoint({
    endpoint: params.connection.endpointUrl,
    manifest,
  });
  const reviewedEndpoint = manifest
    ? resolveMcpProviderEndpoint(manifest, params.connection.authMode)
    : null;
  if (
    reviewedEndpoint?.kind === "fixed"
    && normalized.url !== new URL(reviewedEndpoint.url).toString()
  ) {
    throw new McpRuntimeError(
      "MCP_POLICY_BLOCKED",
      "Stored MCP endpoint does not match the reviewed authentication variant",
    );
  }
  const manifestAuth = (manifest?.authOptions ?? (manifest ? [manifest.auth] : []))
    .find((auth) => mcpProviderAuthMode(auth) === params.connection.authMode);
  const requestHeaders = buildMcpRequestHeaders({
    connection: params.connection,
    expectedHeaderName: manifestAuth?.kind === "api-key-header"
      ? manifestAuth.headerName
      : undefined,
  });
  const credentialedEndpoint = applyMcpQueryCredential({
    connection: params.connection,
    endpoint: new URL(normalized.url),
    expectedParameterName: manifestAuth?.kind === "api-key-query"
      ? manifestAuth.parameterName
      : undefined,
  });
  const { authProvider, oauthProvider } = buildAuth(params.connection, params.oauthState);
  const fetch = withOAuthTokenSingleFlight(params.connection, createHardenedMcpFetch({
    sensitiveHeaderNames: requestHeaders.sensitiveHeaderNames,
    sensitiveQueryParameterNames: credentialedEndpoint.sensitiveQueryParameterNames,
    rejectAuthenticatedCrossOriginRedirects: true,
    maxResponseBytes: MCP_DISCOVERY_LIMITS.maxRawResponseBytes,
  }));
  const endpoint = credentialedEndpoint.endpoint;
  const requestInit = Array.from(requestHeaders.headers).length
    ? { headers: requestHeaders.headers }
    : undefined;
  const transport = params.kind === "STREAMABLE_HTTP"
    ? new StreamableHTTPClientTransport(endpoint, {
        fetch,
        authProvider: authProvider as never,
        requestInit,
      })
    : new SSEClientTransport(endpoint, {
        fetch,
        authProvider: authProvider as never,
        requestInit,
      });
  return { transport, oauthProvider };
}

async function connectWithTransport(params: {
  connection: McpConnectionRecord;
  signal?: AbortSignal;
  kind: McpResolvedTransport;
  oauthState?: string;
}): Promise<ConnectedMcpClient> {
  const { transport, oauthProvider } = createTransport(params);
  const client = createClient(params.connection);
  const timeoutSignal = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
  const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
  try {
    await withObservedMcpOperation({
      spanName: "mcp.initialize",
      operation: "initialize",
      providerKey: params.connection.providerKey,
      attributes: {
        "mcp.connection_id": params.connection.id,
        "mcp.transport": params.kind,
      },
      task: async () => await raceAbort(
        client.connect(transport, { prior: buildPrior(params.connection) as never }),
        signal,
      ),
    });
  } catch (error) {
    const authorizationUrl = oauthProvider?.authorizationUrl;
    await client.close().catch(() => undefined);
    if (authorizationUrl) {
      throw new McpOAuthAuthorizationRequiredError(
        authorizationUrl,
        params.kind,
        { cause: error },
      );
    }
    throw error;
  }
  await recordMcpSuccessfulTransport({
    connectionId: params.connection.id,
    transport: params.kind,
  }).catch((error) => {
    console.warn("[agent-chat] failed to persist successful MCP transport", {
      connectionId: params.connection.id,
      transport: params.kind,
      error: safeMcpErrorDetails(error),
    });
  });
  let closed = false;
  return {
    client,
    transport,
    transportKind: params.kind,
    oauthProvider,
    async close() {
      if (closed) return;
      closed = true;
      if (params.kind === "STREAMABLE_HTTP") {
        await (transport as StreamableHTTPClientTransport).terminateSession().catch(() => undefined);
      }
      await client.close().catch(() => undefined);
    },
  };
}

export async function connectMcpClientUsingTransport(params: {
  connection: McpConnectionRecord;
  signal?: AbortSignal;
  transportKind: McpResolvedTransport;
}): Promise<ConnectedMcpClient> {
  const connect = async (leaseSignal?: AbortSignal) => await connectWithTransport({
    connection: params.connection,
    signal: params.signal && leaseSignal
      ? AbortSignal.any([params.signal, leaseSignal])
      : params.signal ?? leaseSignal,
    kind: params.transportKind,
  });
  return params.connection.authMode === "OAUTH2_AUTHORIZATION_CODE"
    ? await withMcpConnectionSingleFlight(params.connection.id, "oauth-refresh", connect)
    : await connect();
}

function statusCodeFromError(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  for (const key of ["statusCode", "status", "httpStatus"]) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\b(?:HTTP\s*)?(4\d\d|5\d\d)\b/i);
  return match ? Number(match[1]) : null;
}

function isDeterministicTransportIncompatibility(error: unknown): boolean {
  if (error instanceof McpOAuthAuthorizationRequiredError) return false;
  const status = statusCodeFromError(error);
  if (status === 401 || status === 403 || (status !== null && status >= 500)) return false;
  if ([404, 405, 406, 415, 426].includes(status ?? -1)) return true;
  if (status !== 400) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:unsupported|protocol|content[- ]?type|method|streamable|sse|negotiat)/i.test(message);
}

function permittedTransports(connection: McpConnectionRecord): McpResolvedTransport[] {
  const manifest = getMcpProviderManifest(connection.providerKey);
  const reviewed = manifest?.transports.map((transport) =>
    transport === "legacy-sse" ? "LEGACY_SSE" as const : "STREAMABLE_HTTP" as const);
  const allowed = reviewed ?? ["STREAMABLE_HTTP", "LEGACY_SSE"];
  return [
    connection.transportMode,
    connection.lastSuccessfulTransport,
    ...allowed,
  ].filter((kind, index, all): kind is McpResolvedTransport =>
    Boolean(kind) && allowed.includes(kind!) && all.indexOf(kind) === index);
}

export async function connectMcpClient(params: {
  connection: McpConnectionRecord;
  signal?: AbortSignal;
  oauthState?: string;
}): Promise<ConnectedMcpClient> {
  const connect = async (leaseSignal?: AbortSignal) => {
    const signal = params.signal && leaseSignal
      ? AbortSignal.any([params.signal, leaseSignal])
      : params.signal ?? leaseSignal;
    const transports = permittedTransports(params.connection);
    let firstError: unknown;
    for (const [index, kind] of transports.entries()) {
      try {
        return await connectWithTransport({ ...params, signal, kind });
      } catch (error) {
        if (index === 0) firstError = error;
        if (index === transports.length - 1 || !isDeterministicTransportIncompatibility(error)) {
          if (index > 0 && firstError && !(error instanceof McpOAuthAuthorizationRequiredError)) {
            throw new McpUnavailableError(
              "MCP server rejected all permitted HTTP transport families",
              { cause: new AggregateError([firstError, error], "MCP transport negotiation failed") },
            );
          }
          throw error;
        }
      }
    }
    throw new McpConfigurationError("MCP connection has no permitted transport");
  };
  return params.connection.authMode === "OAUTH2_AUTHORIZATION_CODE"
    ? await withMcpConnectionSingleFlight(params.connection.id, "oauth-refresh", connect)
    : await connect();
}

export async function finishMcpOAuthAuthorization(params: {
  connection: McpConnectionRecord;
  callbackParams: URLSearchParams;
  transportKind: McpResolvedTransport;
}): Promise<void> {
  if (params.connection.authMode !== "OAUTH2_AUTHORIZATION_CODE") {
    throw new McpConfigurationError("MCP connection is not configured for OAuth");
  }
  const { transport } = createTransport({
    connection: params.connection,
    kind: params.transportKind,
  });
  try {
    await withObservedMcpOperation({
      spanName: "mcp.oauth.token",
      operation: "oauth-token",
      providerKey: params.connection.providerKey,
      attributes: {
        "mcp.connection_id": params.connection.id,
        "mcp.transport": params.transportKind,
      },
      task: async () => await raceAbort(
        transport.finishAuth(params.callbackParams),
        AbortSignal.timeout(OAUTH_TOKEN_TIMEOUT_MS),
      ),
    });
  } finally {
    await transport.close().catch(() => undefined);
  }
}
