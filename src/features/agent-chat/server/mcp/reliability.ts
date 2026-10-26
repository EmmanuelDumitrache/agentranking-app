import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  slidingWindowLimit,
  slidingWindowLimitMany,
  ValkeyLeaseBusyError,
  withValkeyLease,
} from "@/lib/valkey";
import {
  isTerminalMcpAuthenticationFailure,
  looksLikeAuthenticationFailure,
  mcpErrorCode,
  McpRuntimeError,
} from "./errors";
import { recordMcpOperationalEvent } from "./observability";

function boundedEnvInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

const CIRCUIT_FAILURE_THRESHOLD = boundedEnvInt("MCP_CIRCUIT_FAILURE_THRESHOLD", 3, 2, 20);
const CIRCUIT_COOLDOWN_MS = boundedEnvInt("MCP_CIRCUIT_COOLDOWN_MS", 30_000, 5_000, 10 * 60_000);
const CIRCUIT_FAILURE_WINDOW_MS = boundedEnvInt("MCP_CIRCUIT_FAILURE_WINDOW_MS", 5 * 60_000, 30_000, 60 * 60_000);
const NON_PROVIDER_FAILURE_CODES = new Set([
  "MCP_CONNECTION_NOT_FOUND",
  "MCP_CONNECTION_OWNERSHIP_MISMATCH",
  "MCP_CONNECTION_NOT_READY",
  "MCP_CONNECTION_REAUTH_REQUIRED",
  "MCP_CONNECTION_IN_USE",
  "MCP_ENDPOINT_BLOCKED",
  "MCP_AUTH_REQUIRED",
  "MCP_CATALOG_CHANGED",
  "MCP_CATALOG_STALE",
  "MCP_TOOL_QUARANTINED",
  "MCP_POLICY_BLOCKED",
  "MCP_APPROVAL_REQUIRED",
  "MCP_RATE_LIMITED",
  "MCP_STALE_VERSION",
  "MCP_CONFIGURATION_INVALID",
  "MCP_CONTINUATION_CONTEXT_MISSING",
  "MCP_RUNTIME_META_UNAVAILABLE",
]);

export async function enforceMcpMutationRateLimit(params: {
  appAccountId: string;
  operation: "create" | "connection" | "verify" | "discover" | "oauth" | "binding";
}): Promise<void> {
  const limit = params.operation === "binding"
    ? 60
    : params.operation === "connection"
      ? 40
      : params.operation === "oauth"
        ? 15
        : 20;
  const result = await slidingWindowLimit({
    key: `ratelimit:mcp:${params.operation}:${params.appAccountId}`,
    limit,
    windowMs: 60_000,
  });
  if (!result.success) {
    recordMcpOperationalEvent({
      event: "rate_limit",
      outcome: "blocked",
      reason: params.operation,
    });
    throw new McpRuntimeError("MCP_RATE_LIMITED", "Too many MCP requests; retry after a short delay");
  }
}

export async function enforceMcpInvocationLimits(params: {
  appAccountId: string;
  agentDbId: number;
  connectionId: string;
  bindingId: string;
  descriptorId: string;
  runId: string;
  risk: string;
  maxCallsPerRun: number;
  maxCallsPerTool: number;
}): Promise<void> {
  const rules = [
    {
      key: `ratelimit:mcp:run:${params.appAccountId}:${params.agentDbId}:${params.runId}:${params.bindingId}`,
      limit: params.maxCallsPerRun,
      windowMs: 24 * 60 * 60_000,
    },
    {
      key: `ratelimit:mcp:tool:${params.appAccountId}:${params.runId}:${params.descriptorId}`,
      limit: params.maxCallsPerTool,
      windowMs: 24 * 60 * 60_000,
    },
    {
      key: `ratelimit:mcp:account:${params.appAccountId}`,
      limit: 300,
      windowMs: 60_000,
    },
    {
      key: `ratelimit:mcp:connection:${params.connectionId}`,
      limit: 120,
      windowMs: 60_000,
    },
    ...(["TRANSACTION_PREPARE", "TRADE"].includes(params.risk)
      ? [{
          key: `ratelimit:mcp:transaction-prepare:${params.appAccountId}:${params.agentDbId}:${params.runId}`,
          limit: 3,
          windowMs: 24 * 60 * 60_000,
        }]
      : []),
  ];
  const outcome = await slidingWindowLimitMany(rules);
  if (!outcome.success) {
    recordMcpOperationalEvent({
      event: "rate_limit",
      outcome: "blocked",
      risk: params.risk,
      reason: "quota",
    });
    throw new McpRuntimeError("MCP_RATE_LIMITED", "MCP invocation limit reached");
  }
}

export async function withMcpConnectionSingleFlight<T>(
  connectionId: string,
  operation: "verify" | "discover" | "oauth-start" | "oauth-refresh" | "oauth-token",
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const leaseScope = operation === "verify" || operation === "discover"
    ? "catalog"
    : operation;
  try {
    return await withValkeyLease({
      key: `lease:mcp:${leaseScope}:${connectionId}`,
      ttlMs: 60_000,
      renewEveryMs: 20_000,
    }, async (signal) => await task(signal));
  } catch (error) {
    if (error instanceof ValkeyLeaseBusyError) {
      throw new McpRuntimeError("MCP_RATE_LIMITED", `MCP ${operation} is already in progress`);
    }
    throw error;
  }
}

export async function assertMcpCircuitAvailable(connectionId: string): Promise<void> {
  const connection = await prisma.agentMcpConnection.findUnique({
    where: { id: connectionId },
    select: {
      circuitOpenedAt: true,
      circuitOpenUntil: true,
      status: true,
      deletedAt: true,
    },
  });
  if (!connection || connection.deletedAt || connection.status === "DELETED") {
    throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was deleted");
  }
  if (connection.status === "REAUTH_REQUIRED") {
    throw new McpRuntimeError("MCP_CONNECTION_REAUTH_REQUIRED", "MCP connection must be reauthenticated");
  }
  if (connection.status === "BLOCKED") {
    throw new McpRuntimeError("MCP_ENDPOINT_BLOCKED", "MCP connection is blocked");
  }
  if (!["READY", "DEGRADED"].includes(connection.status)) {
    throw new McpRuntimeError("MCP_CONNECTION_NOT_READY", "MCP connection is not ready");
  }
  if (connection.circuitOpenUntil && connection.circuitOpenUntil.getTime() > Date.now()) {
    recordMcpOperationalEvent({ event: "circuit", outcome: "fast_fail", reason: "open" });
    throw new McpRuntimeError("MCP_PROVIDER_UNAVAILABLE", "MCP provider circuit is temporarily open");
  }
  if (connection.circuitOpenedAt && connection.circuitOpenUntil) {
    const probeUntil = new Date(Date.now() + CIRCUIT_COOLDOWN_MS);
    const claimed = await prisma.agentMcpConnection.updateMany({
      where: {
        id: connectionId,
        deletedAt: null,
        status: { in: ["READY", "DEGRADED"] },
        circuitOpenedAt: connection.circuitOpenedAt,
        circuitOpenUntil: { lte: new Date() },
      },
      data: { circuitOpenUntil: probeUntil },
    });
    if (claimed.count !== 1) {
      recordMcpOperationalEvent({ event: "circuit", outcome: "fast_fail", reason: "half_open_busy" });
      throw new McpRuntimeError(
        "MCP_PROVIDER_UNAVAILABLE",
        "MCP provider circuit is testing recovery; retry shortly",
      );
    }
  }
}

export async function recordMcpCircuitSuccess(connectionId: string): Promise<void> {
  const reset = await prisma.agentMcpConnection.updateMany({
    where: {
      id: connectionId,
      deletedAt: null,
      status: { in: ["READY", "DEGRADED"] },
      OR: [
        { consecutiveFailures: { gt: 0 } },
        { circuitOpenedAt: { not: null } },
        { circuitOpenUntil: { not: null } },
      ],
    },
    data: {
      consecutiveFailures: 0,
      circuitOpenedAt: null,
      circuitOpenUntil: null,
      lastHealthyAt: new Date(),
    },
  });
  if (reset.count > 0) {
    recordMcpOperationalEvent({ event: "circuit", outcome: "closed", reason: "success" });
  }
}

export async function recordMcpCircuitFailure(
  connectionId: string,
  error: unknown,
): Promise<void> {
  const code = mcpErrorCode(error);
  if (
    code === "MCP_AUTH_FAILED"
    || code === "MCP_AUTH_REQUIRED"
    || looksLikeAuthenticationFailure(error)
    || isTerminalMcpAuthenticationFailure(error)
  ) {
    const now = new Date();
    const reauth = await prisma.agentMcpConnection.updateMany({
      where: {
        id: connectionId,
        deletedAt: null,
        status: { in: ["READY", "DEGRADED", "VERIFYING"] },
      },
      data: {
        status: "REAUTH_REQUIRED",
        statusReasonCode: "MCP_AUTH_FAILED",
        statusMessage: "Authentication expired or was revoked",
        circuitOpenedAt: null,
        circuitOpenUntil: null,
        lastErrorAt: now,
        lastErrorCode: "MCP_AUTH_FAILED",
        lastErrorText: "Authentication expired or was revoked",
      },
    });
    if (reauth.count > 0) {
      recordMcpOperationalEvent({ event: "circuit", outcome: "reauth", reason: "terminal_auth" });
    }
    return;
  }
  if (NON_PROVIDER_FAILURE_CODES.has(code)) return;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CIRCUIT_FAILURE_WINDOW_MS);
  const reset = await prisma.agentMcpConnection.updateMany({
    where: {
      id: connectionId,
      deletedAt: null,
      status: { in: ["READY", "DEGRADED", "VERIFYING"] },
      OR: [{ lastErrorAt: null }, { lastErrorAt: { lt: staleBefore } }],
    },
    data: {
      consecutiveFailures: 1,
      lastErrorAt: now,
      lastErrorCode: "MCP_PROVIDER_UNAVAILABLE",
    },
  });
  let consecutiveFailures = 1;
  if (reset.count !== 1) {
    const incremented = await prisma.agentMcpConnection.updateMany({
      where: {
        id: connectionId,
        deletedAt: null,
        status: { in: ["READY", "DEGRADED", "VERIFYING"] },
      },
      data: {
        consecutiveFailures: { increment: 1 },
        lastErrorAt: now,
        lastErrorCode: "MCP_PROVIDER_UNAVAILABLE",
      },
    });
    if (incremented.count !== 1) return;
    const current = await prisma.agentMcpConnection.findFirst({
      where: {
        id: connectionId,
        deletedAt: null,
        status: { in: ["READY", "DEGRADED", "VERIFYING"] },
      },
      select: { consecutiveFailures: true },
    });
    if (!current) return;
    consecutiveFailures = current.consecutiveFailures;
  }
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    const opened = await prisma.agentMcpConnection.updateMany({
      where: {
        id: connectionId,
        deletedAt: null,
        status: { in: ["READY", "DEGRADED", "VERIFYING"] },
        consecutiveFailures: { gte: CIRCUIT_FAILURE_THRESHOLD },
      },
      data: {
        status: "DEGRADED",
        statusReasonCode: "MCP_PROVIDER_UNAVAILABLE",
        statusMessage: "Provider circuit opened after repeated failures",
        circuitOpenedAt: now,
        circuitOpenUntil: new Date(now.getTime() + CIRCUIT_COOLDOWN_MS),
      },
    });
    if (opened.count > 0) {
      recordMcpOperationalEvent({ event: "circuit", outcome: "opened", reason: "failure_threshold" });
    }
  }
}

export function mcpInvocationId(): string {
  return randomUUID();
}
