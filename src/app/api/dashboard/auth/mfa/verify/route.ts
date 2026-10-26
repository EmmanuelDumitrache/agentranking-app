import { NextRequest } from "next/server";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { issueMfaCompletionToken } from "@/lib/account-security/mfa-completion-token";
import { getMfaFactorFlags } from "@/lib/account-security/flags";
import {
  issueMfaTrustToken,
  mfaTrustCookieOptions,
  MFA_TRUST_COOKIE,
} from "@/lib/account-security/mfa-trust";
import {
  verifyProfileMfaFactor,
  type StepUpMethod,
} from "@/lib/account-security/verify-factor";
import { dashboardMfaVerifyRateLimitOk } from "@/lib/dashboard/auth-rate-limit";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.mfaVerified !== false) {
    return securityJsonResponse(
      { ok: true, alreadyVerified: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return securityJsonResponse({ error: "Profile not found" }, { status: 404 });
  }
  const ip = getClientIp(request) ?? "unknown";
  if (!(await dashboardMfaVerifyRateLimitOk(ip, profile.id))) {
    return securityJsonResponse({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: {
    method?: string;
    code?: string;
    loginToken?: string;
    rememberMe?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return securityJsonResponse({ error: "Invalid request" }, { status: 400 });
  }

  const method = body.method as StepUpMethod | undefined;
  if (method !== "totp" && method !== "backup" && method !== "email") {
    return securityJsonResponse({ error: "Invalid method" }, { status: 400 });
  }
  const code = body.code?.trim() ?? "";
  if (!code) {
    return securityJsonResponse({ error: "Code required" }, { status: 400 });
  }

  const flags = getMfaFactorFlags(profile);
  if (!flags.mfaRequired) {
    const completionToken = await issueMfaCompletionToken({
      profileId: profile.id,
      authUserId: session.user.id,
      email: session.user.email ?? profile.email,
    });
    return securityJsonResponse(
      { ok: true, completionToken },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await verifyProfileMfaFactor({
    profileId: profile.id,
    method,
    code,
    loginToken: body.loginToken,
    auditContext: "mfa_challenge",
  });
  if (!result.ok) {
    return securityJsonResponse({ error: result.error }, { status: 401 });
  }

  const completionToken = await issueMfaCompletionToken({
    profileId: profile.id,
    authUserId: session.user.id,
    email: session.user.email ?? profile.email,
  });
  const rememberMe = body.rememberMe === true;
  const response = securityJsonResponse(
    {
      ok: true,
      completionToken,
      method: result.method,
      remembered: rememberMe,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (rememberMe) {
    response.cookies.set(
      MFA_TRUST_COOKIE,
      issueMfaTrustToken(profile.id, profile.mfaTrustVersion),
      mfaTrustCookieOptions(),
    );
  }
  return response;
}
