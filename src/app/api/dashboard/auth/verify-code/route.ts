import { NextRequest } from "next/server";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { getClientIp } from "@/lib/client-ip";
import { dashboardAuthVerifyCodeRateLimitOk } from "@/lib/dashboard/auth-rate-limit";
import { verifyDashboardLoginCode } from "@/lib/dashboard/login-token";
import { isEmailVerifiedForDashboard } from "@/lib/dashboard/auth-users";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  if (!(await dashboardAuthVerifyCodeRateLimitOk(ip))) {
    return securityJsonResponse({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  let code = "";
  let loginToken = "";
  try {
    const body = (await request.json()) as { code?: string; loginToken?: string };
    code = (body.code ?? "").trim();
    loginToken = (body.loginToken ?? "").trim();
  } catch {
    return securityJsonResponse({ error: "Invalid request" }, { status: 400 });
  }
  if (!code || !loginToken) {
    return securityJsonResponse({ error: "Code and session token are required." }, { status: 400 });
  }
  const result = await verifyDashboardLoginCode(loginToken, code, {
    purpose: "sign_in",
    consume: false,
  });
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Code expired. Request a new sign-in email."
        : result.reason === "rate_limited"
          ? "Too many attempts. Request a new sign-in email."
          : result.reason === "code_mismatch"
            ? "Invalid code. Check the email or request a new one."
            : "Invalid sign-in session. Request a new email.";
    return securityJsonResponse(
      { error: message },
      {
        status: result.reason === "rate_limited" ? 429 : 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  if (!(await isEmailVerifiedForDashboard(result.email))) {
    return securityJsonResponse(
      {
        ok: false,
        reason: "unverified",
        email: result.email,
        error: "Confirm your email before signing in. Check your inbox or resend confirmation.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return securityJsonResponse(
    { ok: true, loginToken, email: result.email },
    { headers: { "Cache-Control": "no-store" } },
  );
}
