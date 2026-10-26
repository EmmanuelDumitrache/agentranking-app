import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  getAgentCardDetails,
  getAgentCardRecord,
} from "@/lib/agent-payments/services/agent-issuer-card-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { agentId: agentIdRaw } = await context.params;
  const agentId = Number(agentIdRaw);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const record = await getAgentCardRecord(agentId, auth.appAccountId);
  if (!record) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(record);
}

export async function POST(request: Request, context: RouteContext) {
  const { agentId: agentIdRaw } = await context.params;
  const agentId = Number(agentIdRaw);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const action = new URL(request.url).searchParams.get("action");
  if (action !== "details") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  try {
    const details = await getAgentCardDetails(agentId, auth.appAccountId);
    return NextResponse.json(details);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Card details unavailable" },
      { status: 400 },
    );
  }
}
