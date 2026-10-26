import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unlinkWalletFromProfile } from "@/lib/dashboard/wallet-link";
import { requireDashboardWalletSession } from "@/lib/dashboard/wallet-api-auth";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const auth = await requireDashboardWalletSession(session);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let body: { chain?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const chain = body.chain === "solana" ? "solana" : body.chain === "evm" ? "evm" : null;
  if (!chain) {
    return NextResponse.json({ error: 'chain must be "evm" or "solana"' }, { status: 400 });
  }
  try {
    const summary = await unlinkWalletFromProfile(auth.profile.id, chain);
    const profile = await prisma.userProfile.findUnique({
      where: { id: auth.profile.id },
      select: { walletAddress: true, solanaWallet: true },
    });
    return NextResponse.json({
      summary,
      profile: profile ?? { walletAddress: null, solanaWallet: null },
    });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === "ORPHAN_ACCOUNT") {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: e.message || "Failed to unlink wallet." }, { status: 400 });
  }
}
