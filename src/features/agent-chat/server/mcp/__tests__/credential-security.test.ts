import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  redactExactSensitiveValues,
  redactSensitiveText,
} from "../../../../../lib/security/sensitive-data-redaction";
import {
  applyMcpCredential,
  mcpCredentialSummary,
} from "../credentials";
import {
  mcpConnectionStatusForError,
  mcpErrorCode,
  McpRuntimeError,
} from "../errors";
import type { McpConnectionRecord } from "../types";

async function source(relative: string): Promise<string> {
  return await readFile(path.join(process.cwd(), relative), "utf8");
}

test("a reviewed provider header is set exactly once and cannot be renamed", () => {
  const headers = new Headers();
  headers.append("NANSEN-API-KEY", "browser-supplied-value");
  applyMcpCredential(headers, {
    kind: "api-key-header",
    headerName: "nansen-api-key",
    value: "server-secret",
  }, { expectedHeaderName: "NANSEN-API-KEY" });
  assert.equal(headers.get("NANSEN-API-KEY"), "server-secret");
  assert.equal([...headers].filter(([name]) => name === "nansen-api-key").length, 1);
  assert.throws(() => applyMcpCredential(new Headers(), {
    kind: "api-key-header",
    headerName: "X-Attacker-Chosen",
    value: "server-secret",
  }, { expectedHeaderName: "NANSEN-API-KEY" }));
});

test("stored credential application rejects response-splitting material", () => {
  assert.throws(() => applyMcpCredential(new Headers(), {
    kind: "api-key-header",
    headerName: "X-Partner-Key",
    value: "secret\r\nX-Injected: true",
  }, {}));
});

test("thirdweb-style secretKey URL parameters are always redacted", () => {
  const value = redactSensitiveText(
    "request failed at https://api.thirdweb.com/mcp?secretKey=do-not-log-me&tools=read_contract",
  );
  assert.doesNotMatch(value, /do-not-log-me/);
  assert.match(value, /secretKey=\[REDACTED\]/);
  assert.match(value, /tools=read_contract/);
  const echoed = redactExactSensitiveValues({
    content: "provider echoed exact-key-123456789 in an unlabeled string",
  }, ["exact-key-123456789"]);
  assert.deepEqual(echoed, {
    content: "provider echoed [REDACTED] in an unlabeled string",
  });
});

test("credential summaries never serialize encrypted material or secret values", () => {
  const marker = "DO_NOT_EXPOSE_THIS_CREDENTIAL";
  const summary = mcpCredentialSummary({
    authMode: "API_KEY_HEADER",
    status: "READY",
    credential: {
      fingerprint: "sha256:abcd1234",
      encryptedSecret: marker,
      encryptionKeyId: marker,
      encryptionVersion: 1,
    },
  } as unknown as McpConnectionRecord);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, new RegExp(marker));
  assert.deepEqual(Object.keys(summary).sort(), [
    "authMode",
    "configured",
    "expiresAt",
    "fingerprintSuffix",
    "kind",
    "label",
    "maskedIdentifier",
    "reauthRequired",
  ]);
});

test("cutover credentials remain decryptable under legacy auth-mode AAD", async () => {
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  assert.match(credentials, /LEGACY_AUTH_MODE_AAD/);
  assert.match(credentials, /BEARER_TOKEN: "BEARER"/);
  assert.match(credentials, /OAUTH2_AUTHORIZATION_CODE: "OAUTH"/);
  assert.match(credentials, /OAUTH2_CLIENT_CREDENTIALS: "CLIENT_CREDENTIALS"/);
  assert.match(credentials, /const candidates = \[authMode, legacyMode\]/);
  assert.ok(
    credentials.indexOf("const candidates = [authMode, legacyMode]")
      < credentials.indexOf("plaintext = decryptSecret("),
  );
});

test("catalog credentials and client credentials are derived from reviewed server policy", async () => {
  const configuration = await source("src/features/agent-chat/server/mcp/configuration.ts");
  const credentialRoute = await source("src/app/api/dashboard/mcp/connections/route.ts");
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  assert.match(configuration, /manifestAuth\.headerName/);
  assert.match(configuration, /manifestAuth\.prefix/);
  assert.match(configuration, /reviewedHeader: Boolean\(manifestAuth\)/);
  assert.match(credentialRoute, /tokenEndpoint: z\.string\(\)\.url\(\).*optional/);
  assert.match(credentialRoute, /expectedIssuer: z\.string\(\)\.url\(\).*optional/);
  assert.match(credentials, /Discovered OAuth token endpoint does not match the configured credential endpoint/);
  assert.match(credentials, /expectedIssuer: secret\.expectedIssuer/);
  assert.match(credentials, /addClientAuthentication/);
});

test("reviewed query and tool-argument API keys stay outside durable and model-visible inputs", async () => {
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  const clientFactory = await source("src/features/agent-chat/server/mcp/client-factory.ts");
  const catalog = await source("src/features/agent-chat/server/mcp/catalog.ts");
  const toolAdapter = await source("src/features/agent-chat/server/mcp/tool-adapter.ts");
  const continuation = await source("src/features/agent-chat/server/run/mcp-continuation.ts");
  const network = await source("src/features/agent-chat/server/mcp/network.ts");
  const redaction = await source("src/lib/security/sensitive-data-redaction.ts");
  const endpointPolicy = await source("src/features/agent-chat/server/mcp/endpoint-policy.ts");
  const migration = await source("prisma/migrations/20260826090000_web3_mcp_provider_credentials/migration.sql");
  assert.match(credentials, /authMode: "API_KEY_QUERY" \| "API_KEY_TOOL_ARGUMENT"/);
  assert.match(credentials, /endpoint\.searchParams\.set\(params\.expectedParameterName \?\? secret\.name, secret\.value\)/);
  assert.match(credentials, /\[params\.expectedArgumentName \?\? secret\.name\]: secret\.value/);
  assert.match(clientFactory, /applyMcpQueryCredential/);
  assert.match(clientFactory, /sensitiveQueryParameterNames: credentialedEndpoint\.sensitiveQueryParameterNames/);
  assert.match(network, /query credentials cannot redirect/);
  assert.match(redaction, /secret\[-_\]\?key/);
  assert.match(endpointPolicy, /MCP endpoints cannot contain query parameters/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'API_KEY_QUERY'/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'API_KEY_TOOL_ARGUMENT'/);
  assert.match(toolAdapter, /const remoteArguments = applyMcpToolArgumentCredential/);
  assert.match(toolAdapter, /withoutReviewedCredentialInput/);
  assert.match(toolAdapter, /const credentialSafeResult = redactMcpCredentialEcho/);
  assert.match(toolAdapter, /arguments: remoteArguments/);
  assert.match(toolAdapter, /arguments: argumentsValue/);
  assert.match(continuation, /arguments: applyMcpToolArgumentCredential/);
  assert.match(continuation, /const credentialSafeResult = redactMcpCredentialEcho/);
  assert.match(continuation, /assertMcpToolOutput\(authorizedTool!\.descriptor\.outputSchema, credentialSafeResult\)/);
  assert.match(catalog, /withoutReviewedCredentialArgument/);
  assert.match(catalog, /delete nextProperties\[argumentName\]/);
  assert.match(catalog, /required\.filter\(\(name\) => name !== argumentName\)/);
  assert.match(catalog, /redactMcpCredentialEcho/);
  assert.ok(
    toolAdapter.indexOf("const remoteArguments = applyMcpToolArgumentCredential")
      > toolAdapter.indexOf("const liveAuthorization = await authorizeMcpInvocation"),
  );
  assert.ok(
    continuation.lastIndexOf("return await invokeContinuation")
      > continuation.lastIndexOf("authorizedTool = await authorizeMcpInvocation"),
  );
});

test("OAuth continuation is tenant/resource/redirect bound and consumed once", async () => {
  const start = await source("src/app/api/dashboard/mcp/connections/[connectionId]/oauth/start/route.ts");
  const callback = await source("src/app/api/dashboard/mcp/connections/[connectionId]/oauth/callback/route.ts");
  assert.match(start, /randomBytes\(32\).*base64url/);
  assert.match(start, /appAccountId: access\.appAccountId/);
  assert.match(start, /resourceUrl: mcpExpectedOAuthResourceUrl\(connection\)/);
  assert.match(start, /redirectUri: redirectUrl\.toString\(\)/);
  assert.match(callback, /stateHash: hashState\(state\)/);
  assert.match(callback, /consumedAt: null/);
  assert.match(callback, /expiresAt: \{ gt: now \}/);
  assert.match(callback, /data: \{ consumedAt: now \}/);
  assert.match(callback, /consumed\.count !== 1/);
  assert.match(callback, /transaction\.redirectUri !== mcpOAuthRedirectUrl\(connection\)\.toString\(\)/);
  assert.match(callback, /transaction\.resourceUrl !== mcpExpectedOAuthResourceUrl\(connection\)/);
});

test("OAuth start is connection-single-flight and replaces stale PKCE state", async () => {
  const start = await source("src/app/api/dashboard/mcp/connections/[connectionId]/oauth/start/route.ts");
  assert.match(start, /withMcpConnectionSingleFlight\([\s\S]*?oauthConnection\.id,[\s\S]*?"oauth-start"/);
  assert.match(start, /AbortSignal\.any\(\[request\.signal, leaseSignal\]\)/);
  assert.match(start, /agentMcpOAuthTransaction\.deleteMany\([\s\S]*?connectionId: connection\.id/);
  assert.match(start, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(start, /"auth_mode" = 'OAUTH2_AUTHORIZATION_CODE'[\s\S]*?FOR UPDATE/);
  assert.match(start, /assertMcpPublicUrlResolves\(authorization\.url, signal\)/);
});

test("reviewed OAuth issuer, token endpoint, resource, and scopes are pinned before persistence", async () => {
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  assert.match(credentials, /tokenEndpoint: oauth\.tokenEndpoint/);
  assert.match(credentials, /OAuth authorization issuer does not match the reviewed provider manifest/);
  assert.match(credentials, /OAuth token endpoint does not match the reviewed provider manifest/);
  assert.match(credentials, /OAuth resource audience does not match the reviewed provider manifest/);
  assert.match(credentials, /policy\.scopes\.some\(\(scope\) => !granted\.includes\(scope\)\)/);
  assert.match(credentials, /scope: reviewedScope/);
  assert.match(credentials, /assertOAuthTokensPolicy\(params\.connection, tokens\)/);
});

test("OAuth refresh is single-flight and terminal auth failures enter reauth", async () => {
  const clientFactory = await source("src/features/agent-chat/server/mcp/client-factory.ts");
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  const reliability = await source("src/features/agent-chat/server/mcp/reliability.ts");
  assert.match(clientFactory, /withMcpConnectionSingleFlight\(params\.connection\.id, "oauth-refresh"/);
  assert.match(clientFactory, /withMcpConnectionSingleFlight\(connection\.id, "oauth-token"/);
  assert.match(clientFactory, /new URLSearchParams\(body\)\.has\("grant_type"\)/);
  assert.match(credentials, /const reload = async \(\): Promise<McpOAuthSecret>/);
  assert.match(credentials, /MAX_STORED_CREDENTIAL_BYTES/);
  assert.match(credentials, /"OAUTH_TOKEN_REFRESH"/);
  assert.match(credentials, /"OAUTH_TOKEN_ISSUED"/);
  assert.match(credentials, /await saveMcpSecretWithDb\(save, tx, true\)/);
  assert.match(credentials, /await writeMcpAudit\([\s\S]*authenticationAction[\s\S]*"SUCCEEDED"[\s\S]*, tx\)/);
  assert.match(credentials, /outcome: authenticationAction === "OAUTH_TOKEN_REFRESH" \? "refreshed" : "issued"/);
  assert.match(reliability, /status: "REAUTH_REQUIRED"/);
  assert.match(reliability, /statusReasonCode: "MCP_AUTH_FAILED"/);
});

test("explicit OAuth reconnect rotates the principal before beginning a new grant", async () => {
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  const start = await source("src/app/api/dashboard/mcp/connections/[connectionId]/oauth/start/route.ts");
  const accountUi = await source("src/components/dashboard/mcp-connections-page.tsx");
  const agentUi = await source("src/components/dashboard/agent-mcp-connections-page.tsx");
  assert.match(credentials, /beginMcpOAuthReauthorization/);
  assert.match(credentials, /authorizationContextId: randomUUID\(\)/);
  assert.match(credentials, /expectedCredentialFingerprint: connection\.credential\?\.fingerprint/);
  assert.match(credentials, /agentMcpOAuthTransaction\.deleteMany/);
  assert.match(credentials, /agentMcpContinuation\.deleteMany/);
  assert.match(credentials, /action: "OAUTH_REAUTHENTICATE"/);
  assert.match(start, /forceReauthorization: z\.boolean\(\)/);
  assert.match(start, /await beginMcpOAuthReauthorization/);
  assert.match(start, /connection = refreshed/);
  assert.match(accountUi, /startOAuth\(connection\.id, undefined, true\)/);
  assert.match(agentUi, /forceReauthorization: true/);
});

test("OAuth deletion attempts bounded hardened revocation without weakening local deletion", async () => {
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  const deletion = await source("src/app/api/dashboard/mcp/connections/[connectionId]/route.ts");
  assert.match(credentials, /attemptMcpOAuthTokenRevocation/);
  assert.match(credentials, /revocation_endpoint/);
  assert.match(credentials, /createHardenedMcpFetch\(/);
  assert.match(credentials, /rejectAuthenticatedCrossOriginRedirects: true/);
  assert.match(credentials, /maxResponseBytes: 64 \* 1024/);
  assert.match(credentials, /AbortSignal\.timeout\(5_000\)/);
  assert.match(credentials, /redirect: "manual"/);
  assert.match(credentials, /response\.body\?\.cancel\(\)/);
  assert.match(deletion, /attemptMcpOAuthTokenRevocation\(connection\)/);
  assert.ok(
    deletion.indexOf("attemptMcpOAuthTokenRevocation(connection)")
      > deletion.indexOf("softDeleteMcpConnection({"),
  );
  assert.match(deletion, /oauthRevocation/);
});

test("provider-defined error codes cannot escape the stable MCP error vocabulary", () => {
  assert.equal(mcpErrorCode(Object.assign(new Error("provider failure"), {
    code: "SECRET_BEARER_sk-live-do-not-serialize",
  })), "MCP_PROVIDER_UNAVAILABLE");
  assert.equal(mcpErrorCode(Object.assign(new Error("provider failure"), {
    code: "MCP_RATE_LIMITED",
  })), "MCP_PROVIDER_UNAVAILABLE");
  assert.equal(
    mcpErrorCode(new McpRuntimeError("MCP_RATE_LIMITED", "rate limited")),
    "MCP_RATE_LIMITED",
  );
  assert.equal(
    mcpConnectionStatusForError(new McpRuntimeError(
      "MCP_AUTH_FAILED",
      "OAuth transaction could not be bound to its negotiated transport",
    )),
    "REAUTH_REQUIRED",
  );
});

test("credential rotation and optimistic connection updates commit atomically", async () => {
  const configuration = await source("src/features/agent-chat/server/mcp/configuration.ts");
  const createRoute = await source("src/app/api/dashboard/mcp/connections/route.ts");
  const detailRoute = await source(
    "src/app/api/dashboard/mcp/connections/[connectionId]/route.ts",
  );
  assert.match(createRoute, /idempotencyKey: z\.string\(\)\.uuid\(\)/);
  assert.match(detailRoute, /At least one MCP connection change is required/);
  assert.match(detailRoute, /function parseIfMatchVersion/);
  assert.match(detailRoute, /Number\.isSafeInteger/);
  assert.match(detailRoute, /If-Match and expectedVersion do not match/);
  assert.doesNotMatch(detailRoute, /Number\.parseInt\(ifMatch/);
  assert.match(configuration, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(configuration, /FROM "agent_mcp_connections"[\s\S]*?FOR UPDATE/);
  assert.match(configuration, /deleteMcpSecret\(params\.connection\.id, tx\)/);
  assert.match(configuration, /configureBearerCredential\([\s\S]*?\}, tx\)/);
  assert.match(configuration, /tx\.agentMcpConnection\.updateMany/);
  assert.match(configuration, /version: params\.connection\.version/);
  assert.match(configuration, /throw new McpRuntimeError\("MCP_STALE_VERSION"/);
  assert.match(configuration, /unexpectedCredentialField/);
  assert.match(configuration, /Changing API-key header settings requires a replacement API key/);
  assert.match(configuration, /requires both a client ID and client secret/);
});

test("standalone OAuth credential persistence cannot race auth rotation or soft deletion", async () => {
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  assert.match(credentials, /saveMcpSecretWithDb/);
  assert.match(credentials, /"auth_mode"::text = \$\{params\.authMode\}/);
  assert.match(credentials, /"deleted_at" IS NULL[\s\S]*?FOR UPDATE/);
  assert.match(credentials, /expectedCredentialFingerprint/);
  assert.match(credentials, /FROM "agent_mcp_credentials"[\s\S]*?FOR UPDATE/);
  assert.match(credentials, /credential\.fingerprint !== authorityFingerprint/);
  assert.match(credentials, /expectedCredentialFingerprint: authorityFingerprint/);
  assert.match(credentials, /await prisma\.\$transaction\(async \(tx\) =>/);
});

test("administrator reauthentication atomically revokes local authority and advances the version", async () => {
  const credentials = await source("src/features/agent-chat/server/mcp/credentials.ts");
  const admin = await source("src/lib/admin/operations/mcp-policies.server.ts");
  assert.match(credentials, /forceMcpConnectionReauthentication/);
  assert.match(credentials, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(credentials, /saveMcpSecret\([\s\S]*?\}, tx\)/);
  assert.match(credentials, /tx\.agentMcpConnection\.updateMany/);
  assert.match(credentials, /version: connection\.version/);
  assert.match(credentials, /version: \{ increment: 1 \}/);
  assert.match(credentials, /tx\.agentMcpCatalog\.updateMany/);
  assert.match(credentials, /tx\.agentMcpOAuthTransaction\.deleteMany/);
  assert.match(credentials, /tx\.agentMcpContinuation\.deleteMany/);
  assert.match(credentials, /disabledAt: connection\.disabledAt/);
  assert.match(credentials, /connection\.status === "DISABLED" \? new Date\(\) : undefined/);
  assert.match(credentials, /throw new McpRuntimeError\([\s\S]*?"MCP_STALE_VERSION"/);
  assert.ok(
    credentials.indexOf("attemptMcpOAuthTokenRevocation(connection)")
      > credentials.indexOf("tx.agentMcpContinuation.deleteMany"),
  );
  assert.match(admin, /forceMcpConnectionReauthentication\(connection\)/);
  assert.doesNotMatch(admin, /revokeMcpOAuthAuthorization/);
  assert.match(admin, /\["CONNECTION_ID", "TOOL_PATTERN", "RISK_CLASS"\]\.includes\(params\.scope\)/);
});
