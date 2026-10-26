import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { getDepositConfig } from "@/lib/llm-credits/config";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getServerSession(authOptions);
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json(
      { error: "Authentication required", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  const config = getDepositConfig();
  return NextResponse.json({
    costMarginBps: config.costMarginBps,
    minUsdCents: config.minUsdCents,
    quoteTtlSeconds: config.quoteTtlSeconds,
    depositAsset: config.depositAsset,
    solOverpayToleranceBps: config.solOverpayToleranceBps,
    usdcOverpayToleranceBps: config.usdcOverpayToleranceBps,
  });
}
