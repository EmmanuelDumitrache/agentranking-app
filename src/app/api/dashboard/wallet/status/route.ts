import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { getWalletLinkSummary } from "@/lib/dashboard/wallet-link";
import { requireDashboardWalletSession } from "@/lib/dashboard/wallet-api-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getServerSession(authOptions);
  const auth = await requireDashboardWalletSession(session);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const [summary, access] = await Promise.all([
    getWalletLinkSummary(auth.profile.id),
    getDashboardAccess(session),
  ]);
  return NextResponse.json({
    profile: {
      walletAddress: auth.profile.walletAddress,
      solanaWallet: auth.profile.solanaWallet,
    },
    summary,
    access: {
      ownedCount: access.ownedAgents.length,
      verifiedCount: access.verifiedAgents.length,
      canManage: access.canManage,
    },
  });
}
