import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStakeSiteUrl } from "@/lib/site-url";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.trim().toLowerCase();
  const referral = await prisma.arReferralCode.findUnique({ where: { code } });
  const url = new URL(referral?.destination || getStakeSiteUrl(), request.url);
  if (referral?.code) url.searchParams.set("ref", referral.code);
  const response = NextResponse.redirect(url);
  if (referral?.code && referral.isActive) {
    response.cookies.set("ar_ref", referral.code, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  }
  return response;
}
