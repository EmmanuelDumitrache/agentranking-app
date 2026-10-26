import { NextRequest } from "next/server";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import {
  getMfaFactorFlags,
  isRealDashboardEmail,
} from "@/lib/account-security/flags";
import { dashboardMfaEmailSendRateLimitOk } from "@/lib/dashboard/auth-rate-limit";
import { normalizeDashboardEmail } from "@/lib/dashboard/auth-users";
import { sendDashboardLoginEmail } from "@/lib/dashboard/email-auth";
import {
  issueDashboardLoginToken,
  revokeDashboardLoginToken,
} from "@/lib/dashboard/login-token";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";

export const dynamic = "force-dynamic";

type MfaEmailPurpose = "enroll" | "step_up" | "challenge";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return securityJsonResponse({ error: "Profile not found" }, { status: 404 });
  }

  let body: { email?: string; purpose?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return securityJsonResponse({ error: "Invalid request" }, { status: 400 });
  }

  const purpose: MfaEmailPurpose =
    body.purpose === "enroll" || body.purpose === "step_up" || body.purpose === "challenge"
      ? body.purpose
      : "challenge";
  const flags = getMfaFactorFlags(profile);
  const sessionMfaOk = session.user.mfaVerified !== false;

  if (purpose === "enroll") {
    if (!sessionMfaOk) {
      return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    if (flags.emailOtpMfaEnabled) {
      return securityJsonResponse({ error: "Email login codes are already enabled" }, { status: 400 });
    }
  } else {
    if (purpose === "step_up" && !sessionMfaOk) {
      return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    if (!flags.emailOtpMfaEnabled) {
      return securityJsonResponse({ error: "Email MFA is not enabled" }, { status: 400 });
    }
  }

  const profileEmail =
    profile.email && isRealDashboardEmail(profile.email)
      ? normalizeDashboardEmail(profile.email)
      : "";
  if (!profileEmail) {
    return securityJsonResponse(
      { error: "Add a valid account email before enabling email login codes" },
      { status: 400 },
    );
  }

  const requested = typeof body.email === "string" ? normalizeDashboardEmail(body.email) : "";
  if (requested && requested !== profileEmail) {
    return securityJsonResponse({ error: "Email does not match this account" }, { status: 400 });
  }

  const ip = getClientIp(request) ?? "unknown";
  if (!(await dashboardMfaEmailSendRateLimitOk(ip, profile.id))) {
    return securityJsonResponse({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  try {
    const tokenPurpose = purpose === "enroll" ? "enroll" : "mfa";
    const issued = await issueDashboardLoginToken(profileEmail, { purpose: tokenPurpose });
    const sent = await sendDashboardLoginEmail({
      email: profileEmail,
      code: issued.code,
      completeUrl: issued.completeUrl,
      purpose: purpose === "enroll" ? "enroll" : "mfa",
    });

    if (!sent.sent) {
      await revokeDashboardLoginToken(issued.loginToken);
      return securityJsonResponse(
        { error: sent.error ?? "Could not send email code" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return securityJsonResponse(
      {
        ok: true,
        loginToken: issued.loginToken,
        expiresAt: issued.expiresAt.toISOString(),
        email: profileEmail,
        emailDelivered: true,
        ...(process.env.NODE_ENV === "development" ? { devCode: issued.code } : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[mfa/send-email]", err);
    const message =
      err instanceof Error && err.message.includes("Valkey")
        ? "Verification service is temporarily unavailable. Try again in a moment."
        : "Could not send email code";
    return securityJsonResponse({ error: message }, { status: 500 });
  }
}
