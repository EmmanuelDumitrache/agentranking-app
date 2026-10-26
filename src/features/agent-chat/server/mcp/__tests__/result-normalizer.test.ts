import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMcpMetaResult,
  normalizeMcpToolResult,
} from "../result-normalizer";

const toolSource = {
  connectionId: "conn-1",
  bindingId: "binding-1",
  providerKey: "example",
  risk: "READ_ONLY" as const,
  server: "Example MCP",
  tool: "lookup",
};

test("normalizes successful MCP tool results with provenance", () => {
  const result = normalizeMcpToolResult(
    {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { found: true },
      isError: false,
    },
    toolSource,
  ) as Record<string, unknown>;

  assert.equal(result.ok, true);
  assert.equal(result.status, "success");
  assert.deepEqual(result.source, { kind: "mcp", ...toolSource });
  assert.deepEqual(result.structuredContent, { found: true });
  assert.equal(result.untrustedExternalData, true);
});

test("keeps MCP tool-level failures as definitive tool errors", () => {
  const result = normalizeMcpToolResult(
    { isError: true, content: [{ type: "text", text: "not found" }] },
    toolSource,
  ) as Record<string, unknown>;

  assert.equal(result.ok, false);
  assert.equal(result.status, "tool_error");
});

test("redacts credentials and bounds large binary-shaped output", () => {
  const result = normalizeMcpMetaResult(
    {
      authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
      data: "x".repeat(20_000),
      nested: { apiKey: "sk-test_abcdefghijklmnopqrstuvwxyz" },
    },
    {
      connectionId: "conn-1",
      bindingId: "binding-1",
      providerKey: "example",
      risk: "READ_ONLY" as const,
      server: "Example MCP",
      operation: "read_resource",
    },
  ) as Record<string, unknown>;

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /abcdefghijklmnopqrstuvwxyz/);
  assert.match(serialized, /REDACTED|binary payload omitted/);
  assert.equal(result.truncated, true);
  assert.ok(serialized.length < 70_000);
});
