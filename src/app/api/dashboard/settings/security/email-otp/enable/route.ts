import { NextRequest } from "next/server";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeSecurityAudit } from "@/lib/account-security/audit";
import { getMfaFactorFlags, isRealDashboardEmail } from "@/lib/account-security/flags";
import { normalizeDashboardEmail } from "@/lib/dashboard/auth-users";
import { verifyDashboardLoginCode } from "@/lib/dashboard/login-token";
import { prisma } from "@/lib/db";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.mfaVerified === false) {
    return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) return securityJsonResponse({ error: "Profile not found" }, { status: 404 });
  if (getMfaFactorFlags(profile).emailOtpMfaEnabled) {
    return securityJsonResponse({ error: "Email login codes are already enabled" }, { status: 400 });
  }

  const profileEmail = profile.email ? normalizeDashboardEmail(profile.email) : "";
  if (!profileEmail || !isRealDashboardEmail(profileEmail)) {
    return securityJsonResponse(
      { error: "Add a valid account email before enabling email login codes" },
      { status: 400 },
    );
  }

  let body: { code?: string; loginToken?: string; email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return securityJsonResponse({ error: "Invalid request" }, { status: 400 });
  }
  const loginToken = body.loginToken?.trim() ?? "";
  const code = body.code?.trim() ?? "";
  if (!loginToken || !code) {
    return securityJsonResponse(
      { error: "Confirm the code sent to your email to enable this" },
      { status: 400 },
    );
  }
  const requested = typeof body.email === "string" ? normalizeDashboardEmail(body.email) : profileEmail;
  if (requested !== profileEmail) {
    return securityJsonResponse({ error: "Email does not match this account" }, { status: 400 });
  }

  const verified = await verifyDashboardLoginCode(loginToken, code, {
    purpose: "enroll",
    consume: true,
  });
  if (!verified.ok || verified.email !== profileEmail) {
    return securityJsonResponse({ error: "Invalid or expired code" }, { status: 401 });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.userProfile.update({
      where: { id: profile.id },
      data: {
        emailVerifiedAt: now,
        emailOtpMfaEnabledAt: now,
        mfaTrustVersion: { increment: 1 },
      },
    });
    await tx.authUser.upsert({
      where: { email: profileEmail },
      create: { email: profileEmail, emailVerified: now },
      update: { emailVerified: now },
    });
    await writeSecurityAudit({
      userProfileId: profile.id,
      action: "email_otp_enable",
      metadata: { email: profileEmail },
    }, tx);
  });
  return securityJsonResponse({ ok: true, email: profileEmail });
}
