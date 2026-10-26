import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { createMcpConnection } from "@/features/agent-chat/server/mcp/connection-service";
import { assertDashboardMcpAccountAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { toDashboardMcpConnection } from "@/features/agent-chat/server/mcp/dashboard-dto";
import { enforceMcpMutationRateLimit } from "@/features/agent-chat/server/mcp/reliability";
import { listMcpConnections } from "@/features/agent-chat/server/mcp/repository";
import { mcpApiError } from "@/features/agent-chat/server/mcp/route-helpers";

export const dynamic = "force-dynamic";

const credentialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({
    kind: z.literal("bearer"),
    token: z.string().min(1).max(32_768),
  }).strict(),
  z.object({
    kind: z.literal("api-key-header"),
    value: z.string().min(1).max(32_768),
    headerName: z.string().min(1).max(128).optional(),
    prefix: z.string().max(128).optional(),
  }).strict(),
  z.object({
    kind: z.literal("api-key-query"),
    value: z.string().min(1).max(32_768),
  }).strict(),
  z.object({
    kind: z.literal("api-key-tool-argument"),
    value: z.string().min(1).max(32_768),
  }).strict(),
  z.object({ kind: z.literal("oauth2-authorization-code") }).strict(),
  z.object({
    kind: z.literal("oauth2-client-credentials"),
    clientId: z.string().min(1).max(4_096),
    clientSecret: z.string().min(1).max(32_768),
    tokenEndpoint: z.string().url().max(4_096).optional(),
    scope: z.string().max(4_096).optional(),
    expectedIssuer: z.string().url().max(4_096).optional(),
  }).strict(),
]);

const createSchema = z.object({
  providerKey: z.string().trim().min(1).max(80).nullable().optional(),
  displayName: z.string().trim().min(1).max(120),
  endpointUrl: z.string().url().max(4_096).optional(),
  credential: credentialSchema,
  transportMode: z.enum(["STREAMABLE_HTTP", "LEGACY_SSE"]).optional(),
  enableForAgentId: z.number().int().positive().optional(),
  idempotencyKey: z.string().uuid(),
}).strict();

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = await assertDashboardMcpAccountAccess(session);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const connections = await listMcpConnections({ appAccountId: access.appAccountId });
  return NextResponse.json({
    connections: connections.map(toDashboardMcpConnection),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const session = await getServerSession(authOptions);
    const access = await assertDashboardMcpAccountAccess(session);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
    await enforceMcpMutationRateLimit({
      appAccountId: access.appAccountId,
      operation: "create",
    });
    const input = createSchema.parse(await request.json());
    const result = await createMcpConnection({
      appAccountId: access.appAccountId,
      actorProfileId: access.actorProfileId,
      ...input,
      signal: request.signal,
    });
    return NextResponse.json({
      connection: toDashboardMcpConnection(result.connection),
      verification: result.verification,
      assignment: result.assignment,
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return mcpApiError(error, "Could not create MCP connection");
  }
}
