import "server-only";

import { prisma } from "@/lib/db";
import { McpRuntimeError } from "./errors";
import { recordMcpOperationalEvent } from "./observability";
import {
  getMcpProviderManifest,
  providerAllowsExistingConnection,
} from "./provider-registry";
import type { McpConnectionRecord, McpToolRisk } from "./types";

export const MCP_ADMIN_RULE_SCOPES = [
  "GLOBAL",
  "PROVIDER_KEY",
  "ORIGIN",
  "CONNECTION_ID",
  "ACCOUNT_ID",
  "TOOL_PATTERN",
  "RISK_CLASS",
] as const;

export const MCP_ADMIN_RULE_ACTIONS = [
  "BLOCK_NEW",
  "BLOCK_RUNTIME",
  "QUARANTINE",
] as const;

export type McpAdminRuleScope = (typeof MCP_ADMIN_RULE_SCOPES)[number];
export type McpAdminRuleAction = (typeof MCP_ADMIN_RULE_ACTIONS)[number];

export type McpAdminRule = {
  id: string;
  scope: McpAdminRuleScope;
  value: string;
  action: McpAdminRuleAction;
  active: boolean;
  note: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type McpPlatformPolicyDecision = {
  allowed: boolean;
  quarantined: boolean;
  code?: "MCP_POLICY_BLOCKED" | "MCP_TOOL_QUARANTINED";
  reason?: string;
  ruleId?: string;
};

const FINANCIAL_RISKS = new Set<McpToolRisk>([
  "TRANSACTION_PREPARE",
  "TRADE",
  "SIGN",
  "BROADCAST",
  "PAYMENT",
  "CUSTODY",
]);
const RULE_RISK_CLASSES = new Set<string>([
  "READ_ONLY",
  "ANALYTICS_QUERY",
  "TRANSACTION_PREPARE",
  "WRITE_OFFCHAIN",
  "TRADE",
  "SIGN",
  "BROADCAST",
  "PAYMENT",
  "CUSTODY",
  "INFRA_ADMIN",
  "UNKNOWN",
  "FINANCIAL",
]);

function envEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return value.trim().toLowerCase().replace(/\/$/, "");
  }
}

export function normalizeMcpAdminRuleValue(
  scope: McpAdminRuleScope,
  rawValue: string,
): string {
  const value = rawValue.trim();
  if (!value) throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Policy rule value is required");
  if (value.length > 512) {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Policy rule value is too long");
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Policy rule value contains control characters");
  }
  if (scope === "GLOBAL") {
    if (value !== "*") throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Global policy value must be *");
    return value;
  }
  if (scope === "ORIGIN") {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Origin rules require a valid HTTPS origin");
    }
    const origin = parsed.origin.toLowerCase();
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.hash
      || parsed.search
      || parsed.pathname !== "/"
    ) {
      throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Origin rules require an HTTPS origin without a path");
    }
    return origin;
  }
  if (scope === "RISK_CLASS") {
    const risk = value.toUpperCase();
    if (!RULE_RISK_CLASSES.has(risk)) {
      throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Risk policy value is not a recognized MCP risk class");
    }
    return risk;
  }
  if (scope === "PROVIDER_KEY") return value.toUpperCase();
  return value;
}

export async function listActiveMcpAdminRules(): Promise<McpAdminRule[]> {
  const rows = await prisma.agentMcpAdminRule.findMany({
    where: { active: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows as unknown as McpAdminRule[];
}

function globRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "iu");
}

function toolPatternMatches(pattern: string, providerKey: string | null, toolName: string): boolean {
  try {
    const matcher = globRegex(pattern);
    return matcher.test(toolName) || matcher.test(`${providerKey ?? "custom"}:${toolName}`);
  } catch {
    return false;
  }
}

function connectionRuleMatches(rule: McpAdminRule, params: {
  appAccountId: string;
  providerKey: string | null;
  endpointOrigin: string;
  connectionId?: string;
}): boolean {
  if (!rule.active) return false;
  switch (rule.scope) {
    case "GLOBAL":
      return rule.value === "*";
    case "PROVIDER_KEY":
      return (params.providerKey ?? "custom").toUpperCase() === rule.value.toUpperCase();
    case "ORIGIN":
      return normalizeOrigin(params.endpointOrigin) === normalizeOrigin(rule.value);
    case "CONNECTION_ID":
      return Boolean(params.connectionId) && params.connectionId === rule.value;
    case "ACCOUNT_ID":
      return params.appAccountId === rule.value;
    default:
      return false;
  }
}

function blocked(reason: string, rule?: McpAdminRule): McpPlatformPolicyDecision {
  return {
    allowed: false,
    quarantined: false,
    code: "MCP_POLICY_BLOCKED",
    reason,
    ruleId: rule?.id,
  };
}

export function evaluateMcpConnectionPlatformPolicy(params: {
  phase: "create" | "runtime" | "scheduled-refresh";
  appAccountId: string;
  providerKey: string | null;
  endpointOrigin: string;
  connectionId?: string;
  rules: readonly McpAdminRule[];
}): McpPlatformPolicyDecision {
  if (params.phase === "create" && envEnabled("MCP_NEW_CONNECTIONS_DISABLED")) {
    return blocked("New MCP connections are disabled by platform operations");
  }
  if (params.phase === "create" && !params.providerKey && envEnabled("MCP_CUSTOM_SERVERS_DISABLED")) {
    return blocked("Custom MCP servers are disabled by platform operations");
  }
  if (params.phase === "runtime" && envEnabled("MCP_RUNTIME_DISABLED")) {
    return blocked("MCP runtime use is disabled by platform operations");
  }
  if (params.phase === "scheduled-refresh" && envEnabled("MCP_SCHEDULED_DISCOVERY_DISABLED")) {
    return blocked("Scheduled MCP discovery is disabled by platform operations");
  }
  for (const rule of params.rules) {
    if (!connectionRuleMatches(rule, params)) continue;
    if (params.phase === "create" && rule.action === "BLOCK_NEW") {
      return blocked("New connections matching an administrator policy are disabled", rule);
    }
    if (params.phase !== "create" && ["BLOCK_RUNTIME", "QUARANTINE"].includes(rule.action)) {
      return blocked("This MCP connection is disabled by administrator policy", rule);
    }
  }
  return { allowed: true, quarantined: false };
}

export function evaluateMcpToolPlatformPolicy(params: {
  connection: Pick<McpConnectionRecord, "id" | "appAccountId" | "providerKey" | "endpointOrigin">;
  toolName: string;
  risk: McpToolRisk;
  rules: readonly McpAdminRule[];
}): McpPlatformPolicyDecision {
  const connection = evaluateMcpConnectionPlatformPolicy({
    phase: "runtime",
    appAccountId: params.connection.appAccountId,
    providerKey: params.connection.providerKey,
    endpointOrigin: params.connection.endpointOrigin,
    connectionId: params.connection.id,
    rules: params.rules,
  });
  if (!connection.allowed) return connection;
  if (envEnabled("MCP_TRANSACTION_PREPARE_DISABLED") && params.risk === "TRANSACTION_PREPARE") {
    return blocked("Transaction preparation tools are disabled by platform operations");
  }
  if (envEnabled("MCP_FINANCIAL_TOOLS_DISABLED") && FINANCIAL_RISKS.has(params.risk)) {
    return blocked("Financial MCP tools are disabled by platform operations");
  }
  for (const rule of params.rules) {
    if (!rule.active) continue;
    const matches = rule.scope === "TOOL_PATTERN"
      ? toolPatternMatches(rule.value, params.connection.providerKey, params.toolName)
      : rule.scope === "RISK_CLASS"
        ? rule.value.toUpperCase() === params.risk
          || (rule.value.toUpperCase() === "FINANCIAL" && FINANCIAL_RISKS.has(params.risk))
        : false;
    if (!matches) continue;
    if (rule.action === "QUARANTINE") {
      return {
        allowed: false,
        quarantined: true,
        code: "MCP_TOOL_QUARANTINED",
        reason: "This MCP tool is quarantined by administrator policy",
        ruleId: rule.id,
      };
    }
    if (rule.action === "BLOCK_RUNTIME") {
      return blocked("This MCP tool is disabled by administrator policy", rule);
    }
    // BLOCK_NEW governs connection creation only. It must not unexpectedly
    // disable tools that are already bound to an agent.
  }
  return { allowed: true, quarantined: false };
}

export async function assertMcpNewConnectionAllowed(params: {
  appAccountId: string;
  providerKey: string | null;
  endpointOrigin: string;
}): Promise<void> {
  const decision = evaluateMcpConnectionPlatformPolicy({
    ...params,
    phase: "create",
    rules: await listActiveMcpAdminRules(),
  });
  if (!decision.allowed) {
    recordMcpOperationalEvent({
      event: "policy",
      outcome: "blocked_new",
      providerKey: params.providerKey,
      reason: decision.ruleId ? "admin_rule" : "kill_switch",
    });
    throw new McpRuntimeError(decision.code!, decision.reason!);
  }
}

export async function assertMcpConnectionRuntimeAllowed(
  connection: Pick<McpConnectionRecord, "id" | "appAccountId" | "providerKey" | "endpointOrigin">,
): Promise<void> {
  if (!providerAllowsExistingConnection(
    getMcpProviderManifest(connection.providerKey),
    connection.providerKey,
  )) {
    throw new McpRuntimeError(
      "MCP_POLICY_BLOCKED",
      "This MCP provider no longer has an executable platform manifest",
    );
  }
  const decision = evaluateMcpConnectionPlatformPolicy({
    phase: "runtime",
    ...connection,
    connectionId: connection.id,
    rules: await listActiveMcpAdminRules(),
  });
  if (!decision.allowed) {
    recordMcpOperationalEvent({
      event: "policy",
      outcome: "blocked_runtime",
      providerKey: connection.providerKey,
      reason: decision.ruleId ? "admin_rule" : "kill_switch",
    });
    throw new McpRuntimeError(decision.code!, decision.reason!);
  }
}

export async function assertMcpToolPlatformAllowed(params: {
  connection: Pick<McpConnectionRecord, "id" | "appAccountId" | "providerKey" | "endpointOrigin">;
  toolName: string;
  risk: McpToolRisk;
}): Promise<void> {
  const decision = evaluateMcpToolPlatformPolicy({
    ...params,
    rules: await listActiveMcpAdminRules(),
  });
  if (!decision.allowed) {
    recordMcpOperationalEvent({
      event: "policy",
      outcome: decision.quarantined ? "quarantined" : "blocked_tool",
      providerKey: params.connection.providerKey,
      risk: params.risk,
      reason: decision.ruleId ? "admin_rule" : "kill_switch",
    });
    throw new McpRuntimeError(decision.code!, decision.reason!);
  }
}

export async function mcpScheduledDiscoveryEnabled(): Promise<boolean> {
  if (envEnabled("MCP_RUNTIME_DISABLED") || envEnabled("MCP_SCHEDULED_DISCOVERY_DISABLED")) return false;
  const rules = await listActiveMcpAdminRules();
  return !rules.some((rule) =>
    rule.scope === "GLOBAL"
    && rule.value === "*"
    && rule.action === "BLOCK_RUNTIME",
  );
}
