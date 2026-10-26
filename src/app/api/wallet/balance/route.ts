import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { syncBalance } from "@/lib/agent-payments/services/funding-service";
import { getWalletBalance } from "@/lib/agent-payments/services/wallet-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const [balance, sync] = await Promise.all([
    getWalletBalance(auth.appAccountId),
    syncBalance(auth.appAccountId),
  ]);

  return NextResponse.json({ balance, sync });
}
