import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { linkEvmWalletToProfile } from "@/lib/dashboard/wallet-link";
import { requireDashboardWalletSession } from "@/lib/dashboard/wallet-api-auth";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const auth = await requireDashboardWalletSession(session);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let body: { address?: string; message?: string; signature?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const address = body.address?.trim() ?? "";
  const message = body.message ?? "";
  const signature = body.signature ?? "";
  if (!address || !message || !signature) {
    return NextResponse.json({ error: "address, message, and signature are required" }, { status: 400 });
  }
  try {
    const summary = await linkEvmWalletToProfile(auth.profile.id, address, message, signature);
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
    if (e.code === "WALLET_CONFLICT" || e.message.includes("different email")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return NextResponse.json({ error: e.message || "Failed to link wallet." }, { status: 400 });
  }
}
