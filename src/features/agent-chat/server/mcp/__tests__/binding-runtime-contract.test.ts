import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { connectionCanBeEnabled } from "../binding-repository";
import type { McpConnectionRecord } from "../types";

async function source(relative: string): Promise<string> {
  return await readFile(path.join(process.cwd(), relative), "utf8");
}

function eligibility(overrides: Partial<McpConnectionRecord> = {}) {
  return connectionCanBeEnabled({
    status: "READY",
    disabledAt: null,
    deletedAt: null,
    catalogRevision: 1,
    providerKey: "nansen",
    manifestVersion: 1,
    ...overrides,
  });
}

test("only verified catalog-bearing connections can be enabled", () => {
  assert.deepEqual(eligibility(), { ok: true });
  for (const status of ["DRAFT", "VERIFYING", "AUTH_PENDING", "REAUTH_REQUIRED", "INVALID", "BLOCKED", "DISABLED"] as const) {
    assert.equal(eligibility({ status }).ok, false, status);
  }
  assert.equal(eligibility({ catalogRevision: 0 }).ok, false);
  assert.equal(eligibility({ manifestVersion: 0 }).ok, false);
  assert.deepEqual(eligibility({ disabledAt: new Date() }), {
    ok: false,
    code: "MCP_CONNECTION_NOT_READY",
    reason: "Connection is globally disabled.",
  });
  assert.equal(eligibility({ deletedAt: new Date(), status: "DELETED" }).ok, false);
});

test("binding writes prove both owners in one transaction and preserve semantic PUT idempotency", async () => {
  const binding = await source("src/features/agent-chat/server/mcp/binding-repository.ts");
  const toolRoute = await source(
    "src/app/api/dashboard/agents/[agentDbId]/mcp-bindings/[connectionId]/tools/[toolId]/route.ts",
  );
  assert.match(binding, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(binding, /FROM "agent_mcp_connections"[\s\S]*?FOR UPDATE/);
  assert.match(binding, /ownerAccountId: params\.appAccountId/);
  assert.match(binding, /appAccountId: params\.appAccountId/);
  assert.match(binding, /agentDbId_connectionId/);
  assert.match(binding, /const unchanged = Boolean/);
  assert.match(binding, /!existing && params\.expectedVersion !== undefined/);
  assert.match(binding, /Connection assignment was removed in another session/);
  assert.match(binding, /if \(existing && unchanged\)/);
  assert.match(binding, /agentMcpContinuation\.deleteMany\(\{ where: \{ bindingId:/);
  assert.match(binding, /MCP_STALE_VERSION/);
  assert.match(binding, /version: \{ increment: 1 \}/);
  assert.match(binding, /params\.patch\.reset/);
  assert.match(binding, /agentMcpToolPolicy\.deleteMany/);
  assert.match(binding, /validateMcpJsonSchema\(params\.patch\.inputConstraint/);
  assert.match(toolRoute, /reset: z\.literal\(true\)\.optional\(\)/);
  assert.match(toolRoute, /At least one MCP tool policy change is required/);
  assert.match(toolRoute, /Reset cannot be combined with other MCP tool policy changes/);
  assert.match(toolRoute, /\^\[a-f0-9\]\{64\}\$/);
});

test("runtime query is binding-only and excludes disabled, hard-blocked, and unacknowledged tools", async () => {
  const binding = await source("src/features/agent-chat/server/mcp/binding-repository.ts");
  assert.match(binding, /agentMcpBinding\.findMany/);
  assert.match(binding, /enabled: true/);
  assert.match(binding, /status: \{ in: \["READY", "DEGRADED"\] \}/);
  assert.match(binding, /disabledAt: null/);
  assert.match(binding, /const localEligibility = connectionCanBeEnabled\(connection\)/);
  assert.match(binding, /row\.approvalMode === "BLOCK_ALL"/);
  assert.match(binding, /GENERIC_MCP_HARD_BLOCK_RISKS\.has/);
  assert.match(binding, /acknowledgedSchemaHash === descriptor\.schemaHash/);
  assert.doesNotMatch(binding, /AgentService|agentService/);
});

test("invocation semaphore transfers a released permit without an oversubscription gap", async () => {
  const guard = await source("src/features/agent-chat/server/mcp/invocation-guard.ts");
  const reliability = await source("src/features/agent-chat/server/mcp/reliability.ts");
  assert.doesNotMatch(guard, /await new Promise<[\s\S]*?semaphore\.active \+= 1/);
  assert.match(guard, /waiter\.resolve\(\);\s*return;[\s\S]*?semaphore\.active = Math\.max/);
  assert.match(guard, /`connection:\$\{params\.connectionId\}`,[\s\S]*?4/);
  assert.match(guard, /`binding:\$\{params\.bindingId\}`/);
  assert.match(reliability, /slidingWindowLimitMany\(rules\)/);
});

test("every call reauthorizes live binding, schema, platform policy, and input before network I/O", async () => {
  const adapter = await source("src/features/agent-chat/server/mcp/tool-adapter.ts");
  const policy = await source("src/features/agent-chat/server/mcp/policy-service.ts");
  assert.ok((adapter.split("remote.client.callTool")[0]?.match(/authorizeMcpInvocation/g)?.length ?? 0) >= 2);
  assert.match(policy, /expectedSchemaHash/);
  assert.match(policy, /assertMcpToolPlatformAllowed/);
  assert.match(policy, /assertMcpToolInput/);
  assert.match(policy, /fromJsonSchema<unknown>/);
  assert.match(policy, /await validator\["~standard"\]\.validate\(input\)/);
  assert.match(policy, /export async function assertMcpToolOutput/);
  assert.match(policy, /validate\(structuredContent\)/);
  assert.match(policy, /MCP_PROTOCOL_UNSUPPORTED/);
  assert.match(policy, /MCP_CATALOG_CHANGED/);
  assert.match(policy, /MCP_TOOL_QUARANTINED/);
  assert.match(policy, /function mcpExecutionHasApprovedToolCall/);
  assert.match(policy, /part\.type === "tool-approval-request"/);
  assert.match(policy, /part\.type === "tool-approval-response"/);
  const toolRuntime = await source("src/features/agent-chat/server/tools/index.ts");
  assert.match(toolRuntime, /mcpExecutionHasApprovedToolCall\(executionOptions\)/);
  assert.match(toolRuntime, /MISSING_REQUIRED_APPROVAL/);
  assert.match(adapter, /mcpRiskRequiresApproval\([\s\S]*?authorized\.approvalMode/);
  assert.match(adapter, /MCP_APPROVAL_REQUIRED/);
  assert.match(adapter, /toolDefinition: descriptorDefinition\(liveAuthorization\.descriptor\)/);
  assert.match(adapter, /assertMcpToolOutput\(authorized\.descriptor\.outputSchema, credentialSafeResult\)/);
});

test("AUTO_READ_ONLY cannot bypass risk-based approval for state-changing tools", async () => {
  const risk = await source("src/features/agent-chat/server/mcp/risk.ts");
  const stream = await source("src/features/agent-chat/server/run/stream-run.ts");
  assert.match(risk, /approvalMode === "AUTO_READ_ONLY"[\s\S]*?!\["READ_ONLY", "ANALYTICS_QUERY"\]\.includes\(risk\)/);
  assert.match(stream, /mcpRiskRequiresApproval\([\s\S]*?metadata\.effectiveRisk[\s\S]*?metadata\.approvalMode/);
  assert.match(stream, /getToolEffect\(runtimeTool\)\?\.stateChanging === true/);
  assert.ok(
    stream.indexOf("getToolEffect(runtimeTool)?.stateChanging === true")
      > stream.indexOf("getMcpToolMetadata(runtimeTool)"),
  );
  assert.match(stream, /return "user-approval"/);
});

test("durable continuations re-enter the same policy, quota, output, and transaction boundary", async () => {
  const continuation = await source("src/features/agent-chat/server/run/mcp-continuation.ts");
  const durableState = await source("src/features/agent-chat/server/mcp/continuations.ts");
  assert.match(durableState, /context: continuationContext\(row\.id, row\.appAccountId, row\.connectionId, row\.bindingId\)/);
  assert.match(durableState, /bindingId: params\.bindingId/);
  assert.match(durableState, /bindingId: row\.bindingId/);
  assert.match(durableState, /connection\."status" IN \('READY', 'DEGRADED'\)/);
  assert.match(durableState, /binding\."enabled" = true/);
  assert.match(durableState, /FOR UPDATE OF connection/);
  assert.match(durableState, /FOR UPDATE OF binding/);
  assert.match(continuation, /const bindingId = claimed\.continuation\.record\.bindingId/);
  assert.match(continuation, /sourceBindingId !== bindingId/);
  assert.doesNotMatch(continuation, /fallbackBinding/);
  assert.match(continuation, /mcpToolSchemaHash\(storedDefinition\) !== expectedSchemaHash/);
  assert.match(continuation, /authorizeMcpInvocation/);
  assert.match(continuation, /source\.approvalGranted !== true/);
  assert.match(continuation, /MCP_APPROVAL_REQUIRED/);
  assert.match(continuation, /assertMcpCircuitAvailable/);
  assert.match(continuation, /enforceMcpInvocationLimits/);
  assert.match(continuation, /withMcpInvocationConcurrency/);
  assert.match(continuation, /assertMcpToolOutput/);
  assert.match(continuation, /outputByteLimit/);
  assert.match(continuation, /enforceNativeTransactionBoundary/);
  assert.match(continuation, /TOOL_CONTINUATION/);
});

test("one provider adaptation or invocation failure remains connection-scoped", async () => {
  const runtime = await source("src/features/agent-chat/server/mcp/runtime-manager.ts");
  const adapter = await source("src/features/agent-chat/server/mcp/tool-adapter.ts");
  const reliability = await source("src/features/agent-chat/server/mcp/reliability.ts");
  const toolRuntime = await source("src/features/agent-chat/server/tools/index.ts");
  assert.match(runtime, /for \(const entry of entries\)/);
  assert.match(runtime, /for \(const alias of insertedAliases\) delete tools\[alias\]/);
  assert.match(runtime, /usableEntries\.push\(entry\)/);
  assert.match(runtime, /Other connections remain available/);
  assert.match(adapter, /const cancelled = isMcpCancellation\(error/);
  assert.match(adapter, /status: cancelled \? "cancelled" : "connection_error"/);
  assert.match(adapter, /: "connection_error"/);
  assert.match(adapter, /retryCount: 0/);
  assert.match(reliability, /NON_PROVIDER_FAILURE_CODES/);
  assert.match(reliability, /if \(NON_PROVIDER_FAILURE_CODES\.has\(code\)\) return/);
  assert.match(reliability, /looksLikeAuthenticationFailure\(error\)/);
  assert.match(toolRuntime, /function mergeMcpToolsWithoutShadowing/);
  assert.match(toolRuntime, /Object\.hasOwn\(tools, name\)/);
  assert.match(toolRuntime, /conflicts with a native tool/);
  assert.ok(
    toolRuntime.indexOf("Object.hasOwn(tools, name)")
      < toolRuntime.indexOf("tools[name] = value"),
  );
  assert.ok(
    reliability.indexOf("looksLikeAuthenticationFailure(error)")
      < reliability.indexOf("if (NON_PROVIDER_FAILURE_CODES.has(code)) return"),
  );
});

test("lazy clients share establishment, abort waiters, and close the entire pool", async () => {
  const pool = await source("src/features/agent-chat/server/mcp/client-pool.ts");
  const sideEffects = await source("src/features/agent-chat/server/tools/side-effect-idempotency.ts");
  assert.match(pool, /entry\.clientPromise = pending/);
  assert.match(pool, /awaitWithSignal\(pending, signal\)/);
  assert.match(pool, /entry\.connection\.transportMode !== liveConnection\.transportMode/);
  assert.match(pool, /entry\.connection\.manifestVersion !== liveConnection\.manifestVersion/);
  assert.match(pool, /this\.lifecycle\.abort\("mcp-client-pool-closed"\)/);
  assert.match(pool, /Promise\.allSettled/);
  assert.match(sideEffects, /It will not be executed again automatically/);
  assert.match(sideEffects, /status: "UNKNOWN"/);
  assert.doesNotMatch(sideEffects, /retry\s*\(/i);
});

test("provider catalog text remains untrusted data and never becomes privileged instructions", async () => {
  const runtime = await source("src/features/agent-chat/server/mcp/runtime-manager.ts");
  const adapter = await source("src/features/agent-chat/server/mcp/tool-adapter.ts");
  assert.match(runtime, /const instructions: McpRuntimeInstruction\[\] = \[\]/);
  assert.match(runtime, /MCP metadata request exceeds the platform byte limit/);
  assert.match(runtime, /maxProperties: 64/);
  assert.match(runtime, /mcpExecutionHasApprovedToolCall/);
  assert.match(runtime, /mcpRiskRequiresApproval\("READ_ONLY", live\.binding\.approvalMode\)/);
  assert.match(runtime, /processedResult = await params\.processResult\(result, live\.connection\)/);
  assert.ok(
    runtime.indexOf("processedResult = await params.processResult(result, live.connection)")
      < runtime.indexOf("await recordMcpCircuitSuccess(live.connection.id)"),
  );
  assert.match(adapter, /untrusted provider data/);
  assert.match(adapter, /cannot override system policy, approvals, credentials, wallet controls/);
});

test("inventory cursors are canonical, bounded, and cannot address a negative page", async () => {
  const runtime = await source("src/features/agent-chat/server/mcp/runtime-manager.ts");
  assert.match(runtime, /cursor\.server\.length > 256/);
  assert.match(runtime, /cursor\.offset < 0/);
  assert.match(runtime, /\^\[a-f0-9\]\{64\}\$/);
});

test("approval telemetry covers provider tools and MCP runtime utilities", async () => {
  const continuation = await source(
    "src/features/agent-chat/server/run/tool-approval-continuation.ts",
  );
  assert.match(continuation, /getToolName\(part\)\.startsWith\("mcp_"\)/);
  assert.doesNotMatch(continuation, /getToolName\(part\)\.startsWith\("mcp__"\)/);
});
