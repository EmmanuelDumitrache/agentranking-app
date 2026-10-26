import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { persistAccountSolBalance } from "@/lib/app-account-summary";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import { loadDashboardAccountWalletSummary } from "@/lib/dashboard/wallet-page";
import { resolveSolanaRpcUrl } from "@/lib/solana-rpc-url";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  const access = await getDashboardAccess(session);
  if (!access.signedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const nativeAgentCount = access.ownedAgents.filter(
    isAgentRankingNativeAgent,
  ).length;
  const summary = await loadDashboardAccountWalletSummary(session, {
    nativeAgentCount,
    skipLiveBalance: true,
  });
  if (!summary) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  const publicKey = summary.accountWalletPublicKey;
  if (!publicKey) {
    return NextResponse.json(
      { error: "Account wallet is not provisioned yet." },
      { status: 400 },
    );
  }
  if (
    summary.accountWalletSource !== "custodial" &&
    summary.accountWalletSource !== "linked_solana"
  ) {
    return NextResponse.json(
      { error: "Balance sync is only available for Solana wallets." },
      { status: 400 },
    );
  }
  try {
    const connection = new Connection(resolveSolanaRpcUrl(), "confirmed");
    const lamports = await connection.getBalance(new PublicKey(publicKey));
    if (summary.accountId && summary.accountWalletSource === "custodial") {
      await persistAccountSolBalance(summary.accountId, lamports);
    }
    return NextResponse.json({
      summary: { ...summary, solBalanceLamports: lamports },
      solBalanceLamports: lamports,
    });
  } catch (error) {
    console.error("[account/sync-balance]", error);
    return NextResponse.json(
      {
        error:
          "Could not fetch wallet balance. Check RPC configuration and try again.",
      },
      { status: 503 },
    );
  }
}
