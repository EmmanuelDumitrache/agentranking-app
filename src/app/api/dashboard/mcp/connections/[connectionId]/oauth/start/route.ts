import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { writeMcpAudit } from "@/features/agent-chat/server/mcp/audit";
import { discoverMcpCatalog } from "@/features/agent-chat/server/mcp/catalog";
import {
  connectMcpClient,
  mcpOAuthRedirectUrl,
} from "@/features/agent-chat/server/mcp/client-factory";
import { configureMcpConnection } from "@/features/agent-chat/server/mcp/configuration";
import {
  beginMcpOAuthReauthorization,
  mcpExpectedOAuthResourceUrl,
} from "@/features/agent-chat/server/mcp/credentials";
import { assertDashboardMcpAccountAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { validateMcpOAuthAuthorizationUrl } from "@/features/agent-chat/server/mcp/endpoint-policy";
import { assertMcpPublicUrlResolves } from "@/features/agent-chat/server/mcp/network";
import {
  recordMcpCatalogChanges,
  recordMcpOperationalEvent,
  withObservedMcpOperation,
} from "@/features/agent-chat/server/mcp/observability";
import {
  McpOAuthAuthorizationRequiredError,
  isMcpCancellation,
  mcpConnectionStatusForError,
  mcpErrorCode,
  McpRuntimeError,
} from "@/features/agent-chat/server/mcp/errors";
import { assertMcpConnectionRuntimeAllowed } from "@/features/agent-chat/server/mcp/platform-policy";
import {
  enforceMcpMutationRateLimit,
  withMcpConnectionSingleFlight,
} from "@/features/agent-chat/server/mcp/reliability";
import { getMcpProviderManifest } from "@/features/agent-chat/server/mcp/provider-registry";
import {
  getMcpConnection,
  updateMcpConnectionStatus,
} from "@/features/agent-chat/server/mcp/repository";
import { mcpApiError } from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";
const OAUTH_TRANSACTION_TTL_MS = 10 * 60_000;
const startSchema = z.object({
  returnAgentDbId: z.number().int().positive().optional(),
  forceReauthorization: z.boolean().optional().default(false),
}).strict();

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  let failureContext: {
    appAccountId: string;
    actorProfileId: number;
    connectionId: string;
    providerKey: string | null;
    version: number;
  } | null = null;
  try {
    assertSameOriginMutation(request);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccountAccess(session);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    await enforceMcpMutationRateLimit({ appAccountId: access.appAccountId, operation: "oauth" });
    const rawBody = await request.text();
    const input = startSchema.parse(rawBody ? JSON.parse(rawBody) : {});
    if (input.returnAgentDbId) {
      const agent = await prisma.agent.findFirst({
        where: { id: input.returnAgentDbId, ownerAccountId: access.appAccountId },
        select: { id: true },
      });
      if (!agent) {
        throw new McpRuntimeError(
          "MCP_CONNECTION_OWNERSHIP_MISMATCH",
          "OAuth return agent is not owned by this account",
        );
      }
    }
    const connectionId = (await params).connectionId;
    let connection = await getMcpConnection({
      appAccountId: access.appAccountId,
      connectionId,
    });
    if (!connection) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was not found");
    if (connection.status === "BLOCKED") {
      throw new McpRuntimeError(
        "MCP_ENDPOINT_BLOCKED",
        "This connection is blocked and requires an administrator recovery action",
      );
    }
    await assertMcpConnectionRuntimeAllowed(connection);
    failureContext = {
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      connectionId: connection.id,
      providerKey: connection.providerKey,
      version: connection.version,
    };
    if (connection.authMode !== "OAUTH2_AUTHORIZATION_CODE") {
      connection = await configureMcpConnection({
        connection,
        patch: {
          authMode: "OAUTH2_AUTHORIZATION_CODE",
          expectedVersion: connection.version,
        },
      });
      failureContext.version = connection.version;
    }
    // Capture the narrowed record before entering the async single-flight
    // callback. The callback may replace its local copy after reauthorization,
    // but the account-owned connection can no longer widen back to null.
    const oauthConnection = connection;
    return await withMcpConnectionSingleFlight(
      oauthConnection.id,
      "oauth-start",
      async (leaseSignal) => {
        let connection = oauthConnection;
        if (input.forceReauthorization) {
          await beginMcpOAuthReauthorization({
            connection,
            actorProfileId: access.actorProfileId,
          });
          const refreshed = await getMcpConnection({
            appAccountId: access.appAccountId,
            connectionId: connection.id,
          });
          if (!refreshed) {
            throw new McpRuntimeError(
              "MCP_CONNECTION_NOT_FOUND",
              "MCP connection was removed during OAuth reauthorization",
            );
          }
          connection = refreshed;
          failureContext!.version = connection.version;
        }
        const signal = AbortSignal.any([request.signal, leaseSignal]);
        const state = randomBytes(32).toString("base64url");
        const now = new Date();
        const redirectUrl = mcpOAuthRedirectUrl(connection);
        await prisma.$transaction(async (tx) => {
          const authority = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "agent_mcp_connections"
            WHERE "id" = ${connection.id}
              AND "app_account_id" = ${access.appAccountId}
              AND "auth_mode" = 'OAUTH2_AUTHORIZATION_CODE'
              AND "version" = ${connection.version}
              AND "deleted_at" IS NULL
            FOR UPDATE
          `);
          if (authority.length !== 1) {
            throw new McpRuntimeError(
              "MCP_STALE_VERSION",
              "Connection changed before MCP OAuth state could be created",
            );
          }
          // A connection has one durable PKCE verifier. Invalidate every older
          // state before creating the replacement so concurrent browser starts
          // cannot leave a state/verifier pair that belongs to another flow.
          await tx.agentMcpOAuthTransaction.deleteMany({
            where: { connectionId: connection.id },
          });
          await tx.agentMcpOAuthTransaction.create({
            data: {
              connectionId: connection.id,
              appAccountId: access.appAccountId,
              stateHash: hashState(state),
              redirectUri: redirectUrl.toString(),
              resourceUrl: mcpExpectedOAuthResourceUrl(connection),
              returnAgentDbId: input.returnAgentDbId,
              expiresAt: new Date(now.getTime() + OAUTH_TRANSACTION_TTL_MS),
            },
          });
        });
        await writeMcpAudit({
          appAccountId: access.appAccountId,
          actorProfileId: access.actorProfileId,
          connectionId: connection.id,
          action: "OAUTH_START",
          status: "STARTED",
          metadata: { resourceOrigin: connection.endpointOrigin },
        });
        recordMcpOperationalEvent({
          event: "oauth",
          outcome: "started",
          providerKey: connection.providerKey,
        });
        const connectedRef: {
          current: Awaited<ReturnType<typeof connectMcpClient>> | null;
        } = { current: null };
        try {
          const preserveDisabled = Boolean(connection.disabledAt) || connection.status === "DISABLED";
          const transitioned = await updateMcpConnectionStatus({
            connectionId: connection.id,
            status: "VERIFYING",
            expectedVersion: connection.version,
            expectedStatuses: [connection.status],
          });
          if (!transitioned) {
            throw new McpRuntimeError(
              "MCP_STALE_VERSION",
              "Connection changed before MCP OAuth verification could start",
            );
          }
          const discovery = await withObservedMcpOperation({
            spanName: "mcp.oauth.discover",
            operation: "oauth-discover",
            providerKey: connection.providerKey,
            attributes: { "mcp.connection_id": connection.id },
            task: async () => {
              const connected = await connectMcpClient({
                connection,
                signal,
                oauthState: state,
              });
              connectedRef.current = connected;
              return await discoverMcpCatalog({
                connection,
                client: connected.client,
                signal,
                finalConnectionStatus: preserveDisabled ? "DISABLED" : "READY",
              });
            },
          });
          recordMcpCatalogChanges({ providerKey: connection.providerKey, ...discovery.changes });
          recordMcpOperationalEvent({
            event: "oauth",
            outcome: "connected",
            providerKey: connection.providerKey,
          });
          await writeMcpAudit({
            appAccountId: access.appAccountId,
            actorProfileId: access.actorProfileId,
            connectionId: connection.id,
            action: "OAUTH_START",
            status: "SUCCEEDED",
            metadata: { connectedWithoutRedirect: true, catalogRevision: discovery.changes.revision },
          });
          await prisma.agentMcpOAuthTransaction.deleteMany({
            where: { connectionId: connection.id, stateHash: hashState(state) },
          });
          return NextResponse.json({
            connected: true,
            catalogRevision: discovery.changes.revision,
            returnAgentDbId: input.returnAgentDbId ?? null,
          });
        } catch (error) {
          if (!(error instanceof McpOAuthAuthorizationRequiredError)) throw error;
          const authorization = validateMcpOAuthAuthorizationUrl({
            authorizationUrl: error.authorizationUrl,
            manifest: getMcpProviderManifest(connection.providerKey),
          });
          try {
            await assertMcpPublicUrlResolves(authorization.url, signal);
          } catch (cause) {
            throw new McpRuntimeError(
              "MCP_ENDPOINT_BLOCKED",
              "OAuth authorization hostname is not a permitted public target",
              { cause },
            );
          }
          const bound = await prisma.agentMcpOAuthTransaction.updateMany({
            where: {
              connectionId: connection.id,
              stateHash: hashState(state),
              consumedAt: null,
            },
            data: { transportKind: error.transportKind },
          });
          if (bound.count !== 1) {
            throw new McpRuntimeError(
              "MCP_AUTH_FAILED",
              "OAuth transaction could not be bound to its negotiated transport",
            );
          }
          const pending = await updateMcpConnectionStatus({
            connectionId: connection.id,
            status: "AUTH_PENDING",
            reasonCode: "MCP_AUTH_REQUIRED",
            message: "OAuth authorization is pending",
            expectedVersion: connection.version,
            expectedStatuses: ["VERIFYING"],
          });
          if (!pending) {
            throw new McpRuntimeError(
              "MCP_STALE_VERSION",
              "Connection changed before MCP OAuth authorization could begin",
            );
          }
          recordMcpOperationalEvent({
            event: "oauth",
            outcome: "authorization_required",
            providerKey: connection.providerKey,
          });
          await writeMcpAudit({
            appAccountId: access.appAccountId,
            actorProfileId: access.actorProfileId,
            connectionId: connection.id,
            action: "OAUTH_START",
            status: "SUCCEEDED",
            metadata: { authorizationPending: true },
          });
          return NextResponse.json({
            connected: false,
            authorizationUrl: authorization.url,
          });
        } finally {
          await connectedRef.current?.close().catch(() => undefined);
        }
      },
    );
  } catch (error) {
    const failureCode = mcpErrorCode(error);
    recordMcpOperationalEvent({
      event: "oauth",
      outcome: "failed",
      providerKey: failureContext?.providerKey,
      reason: failureCode,
    });
    if (failureContext) {
      if (
        failureCode !== "MCP_RATE_LIMITED"
        && !isMcpCancellation(error, request.signal)
      ) {
        await updateMcpConnectionStatus({
          connectionId: failureContext.connectionId,
          status: mcpConnectionStatusForError(error),
          error,
          expectedVersion: failureContext.version,
          expectedStatuses: ["DRAFT", "AUTH_PENDING", "VERIFYING", "READY", "DEGRADED", "INVALID"],
        }).catch(() => undefined);
      }
      await writeMcpAudit({
        appAccountId: failureContext.appAccountId,
        actorProfileId: failureContext.actorProfileId,
        connectionId: failureContext.connectionId,
        action: "OAUTH_START",
        status: "FAILED",
        reasonCode: failureCode,
      }).catch(() => undefined);
    }
    return mcpApiError(error, `Could not start MCP OAuth: ${failureCode}`);
  }
}
