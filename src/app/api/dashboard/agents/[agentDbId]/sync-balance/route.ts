import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import {
  getWalletBalances,
  invalidateWalletBalanceCache,
} from "@/features/agent-chat/server/tools/wallet-balance";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

export async function POST(_request: Request, context: RouteContext) {
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

  try {
    await invalidateWalletBalanceCache(id);
    const balances = await getWalletBalances(id);
    if (balances.publicKey == null) {
      return NextResponse.json(
        { error: "Agent wallet is not provisioned yet." },
        { status: 400 },
      );
    }
    if (balances.solBalanceLamports == null) {
      return NextResponse.json(
        {
          error:
            "Could not fetch agent wallet balance. Check RPC configuration and try again.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      publicKey: balances.publicKey,
      solBalanceLamports: balances.solBalanceLamports,
      usdcBalanceRaw: balances.usdcBalance?.amount ?? null,
      arBalanceRaw: balances.arBalance?.amount ?? null,
      solscanUrl: solscanAccountUrlForNetwork(
        balances.publicKey,
        balances.network,
      ),
    });
  } catch (error) {
    console.error("[agent/sync-balance]", error);
    return NextResponse.json(
      {
        error:
          "Could not fetch agent wallet balance. Check RPC configuration and try again.",
      },
      { status: 503 },
    );
  }
}
