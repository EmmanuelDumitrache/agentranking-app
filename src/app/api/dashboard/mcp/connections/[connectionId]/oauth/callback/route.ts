import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppProductSiteUrl } from "@/lib/site-url";
import { writeMcpAudit } from "@/features/agent-chat/server/mcp/audit";
import {
  connectMcpClientUsingTransport,
  finishMcpOAuthAuthorization,
  mcpOAuthRedirectUrl,
} from "@/features/agent-chat/server/mcp/client-factory";
import { discoverMcpCatalog } from "@/features/agent-chat/server/mcp/catalog";
import { mcpExpectedOAuthResourceUrl } from "@/features/agent-chat/server/mcp/credentials";
import { assertDashboardMcpAccountAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import {
  isMcpCancellation,
  mcpConnectionStatusForError,
  mcpErrorCode,
  McpRuntimeError,
} from "@/features/agent-chat/server/mcp/errors";
import {
  getMcpConnection,
  updateMcpConnectionStatus,
} from "@/features/agent-chat/server/mcp/repository";
import { assertMcpConnectionRuntimeAllowed } from "@/features/agent-chat/server/mcp/platform-policy";
import { enforceMcpMutationRateLimit } from "@/features/agent-chat/server/mcp/reliability";
import {
  recordMcpCatalogChanges,
  recordMcpOperationalEvent,
} from "@/features/agent-chat/server/mcp/observability";

export const dynamic = "force-dynamic";

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function connectionsRedirect(params: Record<string, string>): NextResponse {
  const url = new URL("/dashboard/connections", getAppProductSiteUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

function transactionRedirect(
  transaction: { returnAgentDbId: number | null },
  params: Record<string, string>,
): NextResponse {
  if (!transaction.returnAgentDbId) return connectionsRedirect(params);
  const url = new URL(
    `/dashboard/agents/${transaction.returnAgentDbId}/connections`,
    getAppProductSiteUrl(),
  );
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const connectionId = (await params).connectionId;
  const session = await getServerSession(authOptions);
  const access = await assertDashboardMcpAccountAccess(session);
  if (!access.ok) {
    recordMcpOperationalEvent({ event: "oauth", outcome: "failed", reason: "session_required" });
    return connectionsRedirect({ mcp: "auth-session-required" });
  }
  try {
    await enforceMcpMutationRateLimit({ appAccountId: access.appAccountId, operation: "oauth" });
  } catch {
    recordMcpOperationalEvent({ event: "oauth", outcome: "failed", reason: "rate_limited" });
    return connectionsRedirect({ mcp: "error", code: "MCP_RATE_LIMITED" });
  }
  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (!state) {
    recordMcpOperationalEvent({ event: "oauth", outcome: "failed", reason: "state_missing" });
    return connectionsRedirect({ mcp: "error", code: "state_missing" });
  }
  const now = new Date();
  const transaction = await prisma.agentMcpOAuthTransaction.findFirst({
    where: {
      connectionId,
      appAccountId: access.appAccountId,
      stateHash: hashState(state),
      consumedAt: null,
      expiresAt: { gt: now },
    },
  });
  if (!transaction) {
    recordMcpOperationalEvent({ event: "oauth", outcome: "failed", reason: "state_invalid" });
    return connectionsRedirect({ mcp: "error", code: "state_invalid" });
  }
  const consumed = await prisma.agentMcpOAuthTransaction.updateMany({
    where: { id: transaction.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    recordMcpOperationalEvent({ event: "oauth", outcome: "failed", reason: "state_reused" });
    return connectionsRedirect({ mcp: "error", code: "state_reused" });
  }
  const connection = await getMcpConnection({
    appAccountId: access.appAccountId,
    connectionId,
  });
  if (
    !connection
    || connection.authMode !== "OAUTH2_AUTHORIZATION_CODE"
    || transaction.redirectUri !== mcpOAuthRedirectUrl(connection).toString()
    || transaction.resourceUrl !== mcpExpectedOAuthResourceUrl(connection)
    || !transaction.transportKind
  ) {
    recordMcpOperationalEvent({ event: "oauth", outcome: "failed", reason: "binding_invalid" });
    return transactionRedirect(transaction, { mcp: "error", code: "oauth_binding_invalid" });
  }
  if (connection.status === "BLOCKED") {
    recordMcpOperationalEvent({ event: "oauth", outcome: "failed", reason: "connection_blocked" });
    return transactionRedirect(transaction, { mcp: "error", code: "MCP_ENDPOINT_BLOCKED" });
  }
  let connected: Awaited<ReturnType<typeof connectMcpClientUsingTransport>> | null = null;
  try {
    await assertMcpConnectionRuntimeAllowed(connection);
    await finishMcpOAuthAuthorization({
      connection,
      callbackParams: request.nextUrl.searchParams,
      transportKind: transaction.transportKind,
    });
    const refreshed = await getMcpConnection({
      appAccountId: access.appAccountId,
      connectionId,
    });
    if (!refreshed) {
      throw new McpRuntimeError(
        "MCP_CONNECTION_NOT_FOUND",
        "MCP connection disappeared after OAuth exchange",
      );
    }
    if (refreshed.status === "BLOCKED") {
      throw new McpRuntimeError(
        "MCP_ENDPOINT_BLOCKED",
        "This connection was blocked while OAuth authorization was completing",
      );
    }
    const preserveDisabled = Boolean(refreshed.disabledAt) || refreshed.status === "DISABLED";
    const transitioned = await updateMcpConnectionStatus({
      connectionId: refreshed.id,
      status: "VERIFYING",
      expectedVersion: refreshed.version,
      expectedStatuses: [refreshed.status],
    });
    if (!transitioned) {
      throw new McpRuntimeError(
        "MCP_STALE_VERSION",
        "Connection changed before MCP OAuth verification could complete",
      );
    }
    connected = await connectMcpClientUsingTransport({
      connection: refreshed,
      signal: request.signal,
      transportKind: transaction.transportKind,
    });
    const discovery = await discoverMcpCatalog({
      connection: refreshed,
      client: connected.client,
      signal: request.signal,
      finalConnectionStatus: preserveDisabled ? "DISABLED" : "READY",
    });
    recordMcpCatalogChanges({ providerKey: connection.providerKey, ...discovery.changes });
    recordMcpOperationalEvent({
      event: "oauth",
      outcome: "succeeded",
      providerKey: connection.providerKey,
    });
    await writeMcpAudit({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      connectionId,
      action: "OAUTH_CALLBACK",
      status: "SUCCEEDED",
      metadata: { catalogRevision: discovery.changes.revision },
    });
    return transactionRedirect(transaction, { mcp: "connected", connectionId });
  } catch (error) {
    recordMcpOperationalEvent({
      event: "oauth",
      outcome: "failed",
      providerKey: connection.providerKey,
      reason: mcpErrorCode(error),
    });
    if (!isMcpCancellation(error, request.signal)) {
      await updateMcpConnectionStatus({
        connectionId,
        status: mcpConnectionStatusForError(error),
        error,
        expectedVersion: connection.version,
        expectedStatuses: ["DRAFT", "AUTH_PENDING", "VERIFYING", "READY", "DEGRADED", "INVALID"],
      }).catch(() => undefined);
    }
    await writeMcpAudit({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      connectionId,
      action: "OAUTH_CALLBACK",
      status: "FAILED",
      reasonCode: mcpErrorCode(error),
    }).catch(() => undefined);
    return transactionRedirect(transaction, { mcp: "error", code: mcpErrorCode(error) });
  } finally {
    await connected?.close().catch(() => undefined);
  }
}
