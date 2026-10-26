import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { writeMcpAudit } from "@/features/agent-chat/server/mcp/audit";
import { configureMcpConnection } from "@/features/agent-chat/server/mcp/configuration";
import { attemptMcpOAuthTokenRevocation } from "@/features/agent-chat/server/mcp/credentials";
import { assertDashboardMcpAccountAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { toDashboardMcpConnection } from "@/features/agent-chat/server/mcp/dashboard-dto";
import { McpRuntimeError } from "@/features/agent-chat/server/mcp/errors";
import { enforceMcpMutationRateLimit } from "@/features/agent-chat/server/mcp/reliability";
import {
  getMcpConnection,
  softDeleteMcpConnection,
} from "@/features/agent-chat/server/mcp/repository";
import { mcpApiError } from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  endpointUrl: z.string().url().max(4_096).optional(),
  disabled: z.boolean().optional(),
  authMode: z.enum([
    "NONE",
    "BEARER_TOKEN",
    "API_KEY_HEADER",
    "API_KEY_QUERY",
    "API_KEY_TOOL_ARGUMENT",
    "OAUTH2_AUTHORIZATION_CODE",
    "OAUTH2_CLIENT_CREDENTIALS",
  ]).optional(),
  transportMode: z.enum(["STREAMABLE_HTTP", "LEGACY_SSE"]).optional(),
  apiKey: z.string().max(32_768).optional(),
  apiKeyHeaderName: z.string().max(128).optional(),
  apiKeyPrefix: z.string().max(128).optional(),
  bearerToken: z.string().max(32_768).optional(),
  clientId: z.string().max(4_096).optional(),
  clientSecret: z.string().max(32_768).optional(),
  tokenEndpoint: z.string().url().max(4_096).optional(),
  scope: z.string().max(4_096).optional(),
  expectedIssuer: z.string().url().max(4_096).optional(),
  expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value).every((key) => key === "expectedVersion")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one MCP connection change is required",
    });
  }
});

function parseIfMatchVersion(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /^(?:W\/)?"([1-9]\d*)"$/u.exec(value.trim());
  if (!match) return undefined;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : undefined;
}

async function ownedConnection(appAccountId: string, connectionId: string) {
  const connection = await getMcpConnection({ appAccountId, connectionId });
  if (!connection) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was not found");
  return connection;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccountAccess(session);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    const connection = await ownedConnection(access.appAccountId, (await params).connectionId);
    return NextResponse.json({
      connection: toDashboardMcpConnection(connection),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mcpApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccountAccess(session);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    await enforceMcpMutationRateLimit({ appAccountId: access.appAccountId, operation: "connection" });
    const input = patchSchema.parse(await request.json());
    const ifMatch = request.headers.get("if-match");
    const expectedFromHeader = parseIfMatchVersion(ifMatch);
    if (ifMatch && expectedFromHeader === undefined) {
      throw new McpRuntimeError("MCP_STALE_VERSION", "If-Match must contain one exact positive connection version");
    }
    if (expectedFromHeader !== undefined
      && input.expectedVersion !== undefined
      && expectedFromHeader !== input.expectedVersion) {
      throw new McpRuntimeError("MCP_STALE_VERSION", "If-Match and expectedVersion do not match");
    }
    if (expectedFromHeader === undefined && input.expectedVersion === undefined) {
      throw new McpRuntimeError("MCP_STALE_VERSION", "An expected connection version is required");
    }
    const connection = await ownedConnection(access.appAccountId, (await params).connectionId);
    const updated = await configureMcpConnection({
      connection,
      patch: {
        ...input,
        expectedVersion: expectedFromHeader !== undefined
          ? expectedFromHeader
          : input.expectedVersion,
      },
    });
    const credentialFields = new Set(["apiKey", "bearerToken", "clientSecret"]);
    const credentialReplaced = Object.keys(input).some((key) => credentialFields.has(key));
    const changedFields = [...new Set(
      Object.keys(input)
        .filter((key) => key !== "expectedVersion")
        .map((key) => credentialFields.has(key) ? "credential" : key),
    )];
    await writeMcpAudit({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      connectionId: updated.id,
      action: input.disabled === true
        ? "CONNECTION_DISABLE"
        : input.disabled === false
          ? "CONNECTION_ENABLE"
          : "CONNECTION_UPDATE",
      status: "SUCCEEDED",
      metadata: {
        changedFields,
        credentialReplaced,
      },
    });
    return NextResponse.json({ connection: toDashboardMcpConnection(updated) });
  } catch (error) {
    return mcpApiError(error, "Could not update MCP connection");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccountAccess(session);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    await enforceMcpMutationRateLimit({ appAccountId: access.appAccountId, operation: "connection" });
    const connection = await ownedConnection(access.appAccountId, (await params).connectionId);
    const bindings = connection.bindings ?? [];
    const detach = request.nextUrl.searchParams.get("detach") === "true";
    if (bindings.length && !detach) {
      return NextResponse.json({
        error: {
          code: "MCP_CONNECTION_IN_USE",
          message: "Connection is assigned to one or more agents",
        },
        attachedAgents: toDashboardMcpConnection(connection).attachedAgents,
      }, { status: 409 });
    }
    await softDeleteMcpConnection({
      connectionId: connection.id,
      appAccountId: access.appAccountId,
      detachBindings: detach,
    });
    // Use the already-authorized in-memory snapshot for best-effort upstream
    // revocation only after authoritative local deletion succeeds. A concurrent
    // assignment conflict must never revoke a still-live connection's token.
    const oauthRevocation = await attemptMcpOAuthTokenRevocation(connection);
    await writeMcpAudit({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      connectionId: connection.id,
      action: "CONNECTION_DELETE",
      status: "SUCCEEDED",
      metadata: {
        detachedBindings: connection.bindings?.length ?? 0,
        oauthRevocation,
      },
    });
    return NextResponse.json({ ok: true, connectionId: connection.id });
  } catch (error) {
    return mcpApiError(error, "Could not delete MCP connection");
  }
}
