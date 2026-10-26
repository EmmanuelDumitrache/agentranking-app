import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import {
  isSolanaRpcRateLimitedError,
  SOLANA_RPC_BUSY_MESSAGE,
} from "@/lib/agent-launch/solana";
import {
  loadAgentSolanaRegistrationPageData,
  registerAgentOnSolana,
} from "@/lib/agent-solana-registration/service";
import type { AgentSolanaRegistrationPageData } from "@/lib/agent-solana-registration/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await loadAgentSolanaRegistrationPageData(id);
  if (!data) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function POST(_request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await registerAgentOnSolana(id);
    let data: AgentSolanaRegistrationPageData | null = null;
    let chainReadDegraded = false;
    try {
      data = await loadAgentSolanaRegistrationPageData(id);
      chainReadDegraded = Boolean(data?.chainReadDegraded);
    } catch (error) {
      if (!isSolanaRpcRateLimitedError(error)) throw error;
      chainReadDegraded = true;
    }
    return NextResponse.json({
      success: true,
      result,
      data,
      chainReadDegraded,
      warning: chainReadDegraded ? SOLANA_RPC_BUSY_MESSAGE : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    if (isSolanaRpcRateLimitedError(error) || message === SOLANA_RPC_BUSY_MESSAGE) {
      return NextResponse.json({ success: false, error: SOLANA_RPC_BUSY_MESSAGE }, { status: 503 });
    }
    const status = /already registered|wallet needs|does not have/i.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
