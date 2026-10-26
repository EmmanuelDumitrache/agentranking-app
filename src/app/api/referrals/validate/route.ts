import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractReferralCodeFromInput } from "@/lib/referral-code-utils";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const code = extractReferralCodeFromInput(raw);
  if (!code) {
    return NextResponse.json({ valid: false, ownerLabel: "", reason: "" });
  }
  try {
    const referral = await prisma.arReferralCode.findUnique({
      where: { code },
      select: { code: true, isActive: true, ownerWallet: true },
    });
    if (!referral || !referral.isActive) {
      return NextResponse.json({ valid: false, ownerLabel: "", reason: "inactive" });
    }
    const ownerLabel = referral.ownerWallet.slice(0, 8) + "…";
    return NextResponse.json({ valid: true, ownerLabel, reason: "" });
  } catch {
    return NextResponse.json({ valid: false, ownerLabel: "", reason: "" });
  }
}