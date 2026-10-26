import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
export const dynamic = "force-dynamic";
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { confirm?: string };
  try {
    body = (await request.json()) as { confirm?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.confirm !== "DELETE") {
    return NextResponse.json({ error: "Type DELETE to confirm account deletion" }, { status: 400 });
  }
  const profile = await getDashboardUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  const email = session?.user?.email?.trim().toLowerCase();
  try {
    await prisma.$transaction(async (tx) => {
      // Delete the NextAuth user (cascades to auth_accounts, auth_sessions)
      if (email) {
        const authUser = await tx.authUser.findUnique({ where: { email }, select: { id: true } });
        if (authUser) {
          await tx.authUser.delete({ where: { id: authUser.id } });
        }
      }
      // Delete the UserProfile. Prisma cascades handle:
      // - CASCADE: AppAccount → AccountCreditLedger, AgentAlertRule, SapAgentOperatorClaim
      // - SET NULL: ContactInquiry, ArReferralCode, ArReferralEvent, AgentVerificationRequest
      await tx.userProfile.delete({ where: { id: profile.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[delete-account]", err);
    return NextResponse.json(
      { error: "Failed to delete account. Please try again." },
      { status: 500 },
    );
  }
}
