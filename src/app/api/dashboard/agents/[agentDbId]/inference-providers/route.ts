import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { applyInferenceProvidersToAgent } from "@/lib/inference-providers/agent-bindings.server";
import { loadDashboardInferenceState } from "@/lib/inference-providers/dashboard-state.server";
import {
  HttpBodyTooLargeError,
  InvalidJsonBodyError,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ agentDbId: string }> };

const InferenceProvidersPatchSchema = z.strictObject({
  providerIds: z.array(z.string().trim().min(1)).optional().default([]),
});

async function assertOwner(agentDbId: number) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const access = await getDashboardAccess(session);
  if (!access.ownedAgents.some((agent) => agent.id === agentDbId)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

function parseAgentId(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const id = parseAgentId((await context.params).agentDbId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const auth = await assertOwner(id);
  if (auth.error) return auth.error;
  return NextResponse.json(await loadDashboardInferenceState(id));
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const id = parseAgentId((await context.params).agentDbId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const auth = await assertOwner(id);
  if (auth.error) return auth.error;
  let body: z.infer<typeof InferenceProvidersPatchSchema>;
  try {
    body = await parseBoundedJsonBody(request, InferenceProvidersPatchSchema, 8 * 1024);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid inference providers payload" }, { status: 400 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    throw error;
  }
  await applyInferenceProvidersToAgent(id, body.providerIds.slice(0, 1));
  return NextResponse.json(await loadDashboardInferenceState(id));
}
