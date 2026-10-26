import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return await readFile(path.join(process.cwd(), relative), "utf8");
}

test("schema makes connections account-owned and execution agent-binding-owned", async () => {
  const schema = await source("prisma/schema.prisma");
  const connection = schema.match(/model AgentMcpConnection \{[\s\S]*?\n\}/)?.[0] ?? "";
  const service = schema.match(/model AgentService \{[\s\S]*?\n\}/)?.[0] ?? "";
  const binding = schema.match(/model AgentMcpBinding \{[\s\S]*?\n\}/)?.[0] ?? "";
  const descriptor = schema.match(/model AgentMcpToolDescriptor \{[\s\S]*?\n\}/)?.[0] ?? "";
  const policy = schema.match(/model AgentMcpToolPolicy \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(connection, /appAccountId/);
  assert.doesNotMatch(connection, /serviceId|agentDbId\s+Int/);
  assert.doesNotMatch(service, /mcpConnections/);
  assert.match(binding, /@@unique\(\[agentDbId, connectionId\]\)/);
  assert.match(binding, /@@unique\(\[id, connectionId\].*agent_mcp_bindings_policy_scope_key/);
  assert.match(binding, /@@unique\(\[id, connectionId, appAccountId, agentDbId\].*agent_mcp_bindings_continuation_scope_key/);
  assert.match(descriptor, /@@unique\(\[id, connectionId\].*agent_mcp_tool_descriptors_policy_scope_key/);
  assert.match(policy, /binding.*fields: \[bindingId, connectionId\].*references: \[id, connectionId\]/);
  assert.match(policy, /tool.*fields: \[toolId, connectionId\].*references: \[id, connectionId\]/);
  assert.match(binding, /toolPolicies\s+AgentMcpToolPolicy\[\]/);
  assert.match(binding, /continuations\s+AgentMcpContinuation\[\]/);
});

test("cutover migration preserves one binding per legacy relationship and checks ownership/counts", async () => {
  const migration = await source("prisma/migrations/20260825010000_account_mcp_connections/migration.sql");
  assert.match(migration, /INSERT INTO "agent_mcp_bindings"/);
  assert.match(migration, /LEFT JOIN "AgentService"/);
  assert.match(migration, /LEFT JOIN "Agent"/);
  assert.match(migration, /orphaned or cross-account connection relationship/);
  assert.match(migration, /relationship count mismatch/);
  assert.match(migration, /enabled relationship count mismatch/);
  assert.match(migration, /credential\/account ownership mismatch/);
  assert.match(migration, /binding\/account ownership mismatch/);
  assert.match(migration, /orphaned or cross-account auth\/continuation relationship/);
  assert.match(migration, /Legacy continuation ciphertext predates explicit binding/);
  assert.match(migration, /DELETE FROM "agent_mcp_continuations"/);
  assert.match(migration, /agent_mcp_bindings_agent_db_id_app_account_id_fkey/);
  assert.match(migration, /agent_mcp_bindings_connection_id_app_account_id_fkey/);
  assert.match(migration, /agent_mcp_credentials_connection_id_app_account_id_fkey/);
  assert.match(migration, /agent_mcp_continuations_connection_id_app_account_id_fkey/);
  assert.match(migration, /agent_mcp_continuations_binding_scope_fkey/);
  assert.match(migration, /agent_mcp_tool_policies_binding_scope_fkey/);
  assert.match(migration, /agent_mcp_tool_policies_tool_scope_fkey/);
  assert.match(migration, /agent_mcp_bindings_continuation_scope_key/);
  assert.match(migration, /ADD COLUMN "binding_id" TEXT NOT NULL/);
  assert.match(migration, /mcp_credential_ciphertext_guard/);
  assert.match(migration, /credential ciphertext envelope changed/);
  assert.match(migration, /effective_risk".*'UNKNOWN'/s);
  assert.match(migration, /quarantined".*true/s);
  assert.match(migration, /CLIENT_CREDENTIALS'.*'REAUTH_REQUIRED'/s);
  assert.match(migration, /https:\/\/invalid\.invalid\/mcp-reentry-required/);
  assert.match(migration, /Legacy endpoint was not canonical public HTTPS and must be re-entered/);
  assert.match(migration, /\(\/\[\^\?\#\]\*\)\?\$/);
  assert.match(migration, /DROP COLUMN "service_id"/);
  assert.match(migration, /DROP COLUMN "agent_db_id"/);
});

test("connection and binding cascades preserve nullable audit attribution", async () => {
  const schema = await source("prisma/schema.prisma");
  const connection = schema.match(/model AgentMcpConnection \{[\s\S]*?\n\}/)?.[0] ?? "";
  const binding = schema.match(/model AgentMcpBinding \{[\s\S]*?\n\}/)?.[0] ?? "";
  const policy = schema.match(/model AgentMcpToolPolicy \{[\s\S]*?\n\}/)?.[0] ?? "";
  const audit = schema.match(/model AgentMcpAuditLog \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(connection, /bindings\s+AgentMcpBinding\[\]/);
  assert.match(binding, /connection\s+AgentMcpConnection.*onDelete: Cascade/);
  assert.match(policy, /binding\s+AgentMcpBinding.*onDelete: Cascade/);
  assert.match(audit, /binding\s+AgentMcpBinding\?.*onDelete: SetNull/);
  assert.match(audit, /connection\s+AgentMcpConnection\?.*onDelete: SetNull/);
  assert.match(audit, /tool\s+AgentMcpToolDescriptor\?.*onDelete: SetNull/);
});

test("runtime is binding-only and catalog-first", async () => {
  const repository = await source("src/features/agent-chat/server/mcp/binding-repository.ts");
  const runtime = await source("src/features/agent-chat/server/mcp/runtime-manager.ts");
  assert.match(repository, /agentMcpBinding\.findMany/);
  assert.match(repository, /status: \{ in: \["READY", "DEGRADED"\] \}/);
  assert.match(runtime, /listRuntimeMcpBindings/);
  assert.match(runtime, /isCatalogWithinMaximumStaleAge/);
  assert.doesNotMatch(runtime, /discoverMcpCatalog|ensureMcpConnectionForService/);
});

test("mutating dashboard routes enforce origin and tenant access", async () => {
  const connectionRoute = await source("src/app/api/dashboard/mcp/connections/[connectionId]/route.ts");
  const bindingRoute = await source("src/app/api/dashboard/agents/[agentDbId]/mcp-bindings/[connectionId]/route.ts");
  const routeHelpers = await source("src/features/agent-chat/server/mcp/route-helpers.ts");
  for (const route of [connectionRoute, bindingRoute]) {
    assert.match(route, /assertSameOriginMutation/);
    assert.match(route, /assertDashboardMcp/);
  }
  assert.match(connectionRoute, /appAccountId/);
  assert.match(bindingRoute, /agentDbId/);
  assert.match(routeHelpers, /\^\[1-9\]\\d\*\$/);
  assert.match(routeHelpers, /Number\.isSafeInteger/);
  assert.doesNotMatch(routeHelpers, /Number\.parseInt/);
});

test("shared connection deletion reports affected agents before an explicit detach", async () => {
  const route = await source("src/app/api/dashboard/mcp/connections/[connectionId]/route.ts");
  const repository = await source("src/features/agent-chat/server/mcp/repository.ts");
  assert.match(route, /bindings\.length && !detach/);
  assert.match(route, /MCP_CONNECTION_IN_USE/);
  assert.match(route, /attachedAgents/);
  assert.match(route, /detachBindings: detach/);
  assert.match(repository, /FROM "agent_mcp_connections"[\s\S]*?FOR UPDATE/);
  assert.match(repository, /attachedBindings > 0 && !params\.detachBindings/);
  assert.match(repository, /agentMcpBinding\.deleteMany/);
  assert.match(repository, /agentMcpCredential\.deleteMany/);
  assert.match(repository, /agentMcpOAuthTransaction\.deleteMany/);
  assert.match(repository, /agentMcpContinuation\.deleteMany/);
  assert.match(repository, /status: "DELETED"/);
});

test("global re-enable only restores ready state from a still-usable catalog", async () => {
  const configuration = await source("src/features/agent-chat/server/mcp/configuration.ts");
  assert.match(configuration, /isCatalogReusableForConnection\(persistedCatalog, params\.connection\)/);
  assert.match(configuration, /isCatalogWithinMaximumStaleAge\(persistedCatalog\)/);
  assert.match(configuration, /canResumeFromCatalog \? "READY" : "DRAFT"/);
});

test("connection-create idempotency resumes an interrupted workflow without replacing a stored secret", async () => {
  const service = await source("src/features/agent-chat/server/mcp/connection-service.ts");
  assert.match(service, /Idempotency key was already used for different MCP connection parameters/);
  assert.match(service, /created\.created \|\| \(mode !== "NONE" && !connection\.credential\)/);
  assert.match(service, /without[\s\S]*overwriting a credential that was already committed/);
  assert.match(service, /if \(connection\.status !== "READY"\)/);
  assert.match(service, /retryCount: created\.created \? 0 : 1/);
  assert.match(service, /created: created\.created/);
});

test("configuration preserves global disable and administrator block across unrelated edits", async () => {
  const configuration = await source("src/features/agent-chat/server/mcp/configuration.ts");
  assert.match(configuration, /const preserveDisabled = params\.connection\.status === "DISABLED"/);
  assert.match(configuration, /params\.patch\.disabled !== false/);
  assert.match(configuration, /const preserveBlocked = params\.connection\.status === "BLOCKED"/);
  assert.match(configuration, /\["REAUTH_REQUIRED", "INVALID"\]\.includes\(params\.connection\.status\)/);
  assert.match(configuration, /disabledAt: params\.patch\.disabled === true/);
  assert.match(configuration, /params\.patch\.disabled === false[\s\S]*?\? null/);
  assert.ok(configuration.indexOf("const status = preserveRecoveryState") >= 0);
  assert.ok(configuration.indexOf("const status = preserveRecoveryState") < configuration.indexOf('params.patch.disabled === true'));
  assert.ok(
    configuration.indexOf(": remoteChanged")
      < configuration.indexOf('params.patch.disabled === false && params.connection.status === "DISABLED"'),
  );
});

test("catalog commit and status writes cannot revive a concurrently controlled connection", async () => {
  const repository = await source("src/features/agent-chat/server/mcp/repository.ts");
  const discovery = await source("src/features/agent-chat/server/mcp/discovery-service.ts");
  const reliability = await source("src/features/agent-chat/server/mcp/reliability.ts");
  assert.match(repository, /expectedStatuses\?: McpConnectionStatus\[\]/);
  assert.match(repository, /notIn: \["DISABLED", "BLOCKED", "DELETED", "REAUTH_REQUIRED"\]/);
  assert.match(repository, /version: params\.connection\.version/);
  assert.match(repository, /"status"::text = 'VERIFYING'[\s\S]*?FOR UPDATE/);
  assert.match(repository, /status: "VERIFYING"/);
  assert.match(repository, /Connection changed while its MCP catalog was being discovered/);
  assert.match(discovery, /Boolean\(connection\.disabledAt\) \|\| connection\.status === "DISABLED"/);
  assert.match(discovery, /connection\.status === "BLOCKED" && !params\.administrativeOverride/);
  assert.match(discovery, /expectedStatuses: \[connection\.status\]/);
  assert.match(discovery, /\["REAUTH_REQUIRED", "BLOCKED", "INVALID"\]\.includes\(failureStatus\)/);
  assert.match(reliability, /status: \{ in: \["READY", "DEGRADED", "VERIFYING"\] \}/);
  assert.match(reliability, /operation === "verify" \|\| operation === "discover"/);
  assert.match(reliability, /`lease:mcp:\$\{leaseScope\}:\$\{connectionId\}`/);
  assert.doesNotMatch(reliability, /agentMcpConnection\.update\(\{\s*where: \{ id: connectionId \}/);
});

test("principal changes and global suspension revoke pending OAuth and continuation capabilities", async () => {
  const configuration = await source("src/features/agent-chat/server/mcp/configuration.ts");
  assert.match(configuration, /remoteChanged \|\| params\.patch\.disabled === true/);
  assert.match(configuration, /tx\.agentMcpOAuthTransaction\.deleteMany/);
  assert.match(configuration, /tx\.agentMcpContinuation\.deleteMany/);
});
