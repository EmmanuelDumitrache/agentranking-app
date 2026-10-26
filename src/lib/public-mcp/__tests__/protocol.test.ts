import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_MCP_TOOLS } from "../catalog.ts";
import {
  PUBLIC_MCP_CANONICAL_ORIGIN,
  publicMcpEndpointUrl,
  resolvePublicMcpAdvertisedOrigin,
} from "../config.ts";
import { handlePublicMcpBody, prefersMcpSse } from "../protocol.ts";

async function stubTool() {
  return { ok: true };
}

test("initialize returns server info and tools capability", async () => {
  const handled = await handlePublicMcpBody(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test" } },
    },
    stubTool,
  );
  assert.equal(handled.kind, "response");
  if (handled.kind !== "response") return;
  const payload = handled.payload as {
    result: { serverInfo: { name: string }; capabilities: { tools: unknown } };
  };
  assert.equal(payload.result.serverInfo.name, "agentranking");
  assert.ok(payload.result.capabilities.tools);
});

test("tools/list includes the public catalog", async () => {
  const handled = await handlePublicMcpBody(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    stubTool,
  );
  assert.equal(handled.kind, "response");
  if (handled.kind !== "response") return;
  const payload = handled.payload as { result: { tools: Array<{ name: string }> } };
  const names = payload.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, PUBLIC_MCP_TOOLS.map((tool) => tool.name));
  assert.ok(names.includes("search_agents"));
  assert.ok(names.includes("get_agent_credential"));
  assert.ok(names.includes("get_fairscale_assessment"));
});

test("unknown JSON-RPC method returns -32601", async () => {
  const handled = await handlePublicMcpBody(
    { jsonrpc: "2.0", id: 3, method: "not/a/method" },
    stubTool,
  );
  assert.equal(handled.kind, "response");
  if (handled.kind !== "response") return;
  const payload = handled.payload as { error: { code: number } };
  assert.equal(payload.error.code, -32601);
});

test("initialized notification has no JSON-RPC body", async () => {
  const handled = await handlePublicMcpBody(
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    stubTool,
  );
  assert.equal(handled.kind, "empty");
});

test("unknown tool call is a tool error, not a protocol error", async () => {
  const handled = await handlePublicMcpBody(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "launch_token", arguments: {} },
    },
    stubTool,
  );
  assert.equal(handled.kind, "response");
  if (handled.kind !== "response") return;
  const payload = handled.payload as { result: { isError: boolean } };
  assert.equal(payload.result.isError, true);
});

test("SSE is used only when JSON is not accepted", () => {
  assert.equal(prefersMcpSse("application/json, text/event-stream"), false);
  assert.equal(prefersMcpSse("text/event-stream"), true);
  assert.equal(prefersMcpSse(null), false);
});

test("production advertised origin is never localhost", () => {
  assert.equal(
    resolvePublicMcpAdvertisedOrigin("http://localhost:3000", "production"),
    PUBLIC_MCP_CANONICAL_ORIGIN,
  );
  assert.equal(
    resolvePublicMcpAdvertisedOrigin("https://app.agentranking.io", "production"),
    PUBLIC_MCP_CANONICAL_ORIGIN,
  );
  assert.equal(
    publicMcpEndpointUrl(PUBLIC_MCP_CANONICAL_ORIGIN),
    "https://agentranking.io/api/mcp",
  );
});

test("local development may advertise localhost", () => {
  assert.equal(
    resolvePublicMcpAdvertisedOrigin("http://localhost:3000", "development"),
    "http://localhost:3000",
  );
});
