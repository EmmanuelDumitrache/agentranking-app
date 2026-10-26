import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadAgentWalletSummary } from "@/lib/agent-wallet-summary.server";
import { serializeCustodialWalletPublic } from "@/lib/custodial-wallet/serialize";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";

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
    return NextResponse.json({
      wallet: null,
      provisionBlocked:
        "Agent wallet is not provisioned. Provisioning may be blocked by configuration.",
      agentName: access.agent.name,
      isNative: isAgentRankingNativeAgent(access.agent),
    });
  }
  return NextResponse.json({
    wallet: serializeCustodialWalletPublic({
      publicKey: summary.solana.address,
      scope: "AGENT",
    }),
    agentName: access.agent.name,
    isCustodial: summary.solana.isCustodial,
    solscanUrl: summary.solana.explorerUrl,
  });
}
