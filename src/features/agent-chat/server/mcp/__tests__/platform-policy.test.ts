import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateMcpConnectionPlatformPolicy,
  evaluateMcpToolPlatformPolicy,
  normalizeMcpAdminRuleValue,
  type McpAdminRule,
} from "../platform-policy";

const connection = {
  id: "connection-1",
  appAccountId: "account-1",
  providerKey: "lifi",
  endpointOrigin: "https://mcp.li.quest",
};

function rule(overrides: Partial<McpAdminRule>): McpAdminRule {
  return {
    id: "rule-1",
    scope: "GLOBAL",
    value: "*",
    action: "BLOCK_RUNTIME",
    active: true,
    note: "test",
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

test("BLOCK_NEW applies only during connection creation", () => {
  const rules = [rule({ action: "BLOCK_NEW" })];
  assert.equal(evaluateMcpConnectionPlatformPolicy({
    phase: "create",
    ...connection,
    rules,
  }).allowed, false);
  assert.equal(evaluateMcpConnectionPlatformPolicy({
    phase: "runtime",
    ...connection,
    rules,
  }).allowed, true);
});

test("tool BLOCK_RUNTIME and QUARANTINE are distinct while tool BLOCK_NEW has no runtime effect", () => {
  const base = { connection, toolName: "build_swap_transaction", risk: "TRANSACTION_PREPARE" as const };
  assert.equal(evaluateMcpToolPlatformPolicy({
    ...base,
    rules: [rule({ scope: "TOOL_PATTERN", value: "lifi:build_*", action: "BLOCK_NEW" })],
  }).allowed, true);
  const blocked = evaluateMcpToolPlatformPolicy({
    ...base,
    rules: [rule({ scope: "TOOL_PATTERN", value: "lifi:build_*", action: "BLOCK_RUNTIME" })],
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.quarantined, false);
  const quarantined = evaluateMcpToolPlatformPolicy({
    ...base,
    rules: [rule({ scope: "RISK_CLASS", value: "FINANCIAL", action: "QUARANTINE" })],
  });
  assert.equal(quarantined.allowed, false);
  assert.equal(quarantined.quarantined, true);
  assert.equal(quarantined.code, "MCP_TOOL_QUARANTINED");
});

test("admin rule normalization validates global, origin, provider, and risk values", () => {
  assert.equal(normalizeMcpAdminRuleValue("GLOBAL", "*"), "*");
  assert.equal(normalizeMcpAdminRuleValue("ORIGIN", "https://MCP.LI.QUEST"), "https://mcp.li.quest");
  assert.equal(normalizeMcpAdminRuleValue("PROVIDER_KEY", "lifi"), "LIFI");
  assert.equal(normalizeMcpAdminRuleValue("RISK_CLASS", "financial"), "FINANCIAL");
  assert.throws(() => normalizeMcpAdminRuleValue("GLOBAL", "anything"));
  assert.throws(() => normalizeMcpAdminRuleValue("ORIGIN", "http://mcp.li.quest/path"));
  assert.throws(() => normalizeMcpAdminRuleValue("RISK_CLASS", "NOT_A_RISK"));
});
