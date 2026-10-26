/**
 * GET /api/dashboard/agents/[agentDbId]/evm-wallet
 * Returns the serialisable EVM wallet status for an owned dashboard agent.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadAgentEvmWalletSnapshot } from "@/lib/agent-evm-wallet.server";

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
  return NextResponse.json(await loadAgentEvmWalletSnapshot(id));
}
