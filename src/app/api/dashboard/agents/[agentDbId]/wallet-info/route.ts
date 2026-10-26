import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadAgentWalletSummary } from "@/lib/agent-wallet-summary.server";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";

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
    const error =
      access.status === 401
        ? "Unauthorized"
        : access.status === 403
          ? "Forbidden"
          : "Agent not found";
    return NextResponse.json({ error }, { status: access.status });
  }
  const summary = await loadAgentWalletSummary(id);
  if (!summary.solana.address) {
    return NextResponse.json(
      { error: "Agent wallet is not provisioned yet." },
      { status: 400 },
    );
  }
  return NextResponse.json({
    publicKey: summary.solana.address,
    solanaNetwork: getAgentLaunchConfig().network,
  });
}
