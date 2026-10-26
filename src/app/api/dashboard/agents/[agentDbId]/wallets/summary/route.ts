/**
 * GET /api/dashboard/agents/[agentDbId]/wallets/summary
 * Returns a server-read multi-chain wallet summary for an owned agent.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadAgentWalletSummary } from "@/lib/agent-wallet-summary.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = /^\d+$/.test(agentDbId) ? Number(agentDbId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    const error = access.status === 401 ? "Unauthorized" : access.status === 403 ? "Forbidden" : "Agent not found";
    return NextResponse.json({ error }, { status: access.status });
  }
  return NextResponse.json(await loadAgentWalletSummary(id));
}
