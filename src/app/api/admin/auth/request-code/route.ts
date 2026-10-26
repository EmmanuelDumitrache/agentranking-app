import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { getAdminLoginEmail, sendAdminLoginEmail } from "@/lib/admin-email-login";
import { issueAdminLoginToken } from "@/lib/admin-login-token";
import { adminLoginRequestRateLimitOk } from "@/lib/admin-login-rate-limit";
import { getAdminLoginEnvDiagnostics } from "@/lib/admin-auth-env";
export const dynamic = "force-dynamic";
const GENERIC_MESSAGE =
  "If sign-in is configured, check the admin inbox. The code expires in 5 minutes.";
/**
 * POST /api/admin/auth/request-code
 * Body: { rememberMe?: boolean }
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  if (!(await adminLoginRequestRateLimitOk(ip))) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a few minutes." },
      { status: 429 },
    );
  }
  let rememberMe = false;
  try {
    const body = (await request.json()) as { rememberMe?: boolean };
    rememberMe = body.rememberMe === true;
  } catch {
    // empty body is fine
  }
  const isDev = process.env.NODE_ENV === "development";
  const diag = getAdminLoginEnvDiagnostics();
  const loginEmail = getAdminLoginEmail();
  if (!loginEmail) {
    console.warn("[admin/auth/request-code] ADMIN_LOGIN_EMAIL not set");
    return NextResponse.json({
      ok: false,
      configured: false,
      emailSent: false,
      message: GENERIC_MESSAGE,
      ...(isDev ? { devHint: diag.devHint } : {}),
    });
  }
  if (!diag.sessionSecretOk) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        emailSent: false,
        message: "Admin sign-in is not configured on this server.",
        ...(isDev ? { devHint: diag.devHint } : {}),
      },
      { status: 503 },
    );
  }
  try {
    const issued = issueAdminLoginToken(rememberMe);
    const sent = await sendAdminLoginEmail({
      code: issued.code,
      completeUrl: issued.completeUrl,
    });
    if (!sent.sent) {
      console.error("[admin/auth/request-code] email failed:", sent.error);
      if (isDev) {
        console.warn(
          "[admin/auth/request-code] dev fallback — code:",
          issued.code,
          "link:",
          issued.completeUrl,
        );
      }
      return NextResponse.json({
        ok: isDev,
        configured: true,
        emailSent: false,
        loginToken: isDev ? issued.loginToken : undefined,
        message: sent.sent
          ? GENERIC_MESSAGE
          : "Could not send sign-in email. Check Resend configuration.",
        expiresAt: issued.expiresAt.toISOString(),
        ...(isDev
          ? {
              devHint:
                sent.error ??
                "Check the terminal running `pnpm run dev` for the code if RESEND_API_KEY is missing.",
              devCodeLogged: !sent.sent,
            }
          : {}),
      });
    }
    return NextResponse.json({
      ok: true,
      configured: true,
      emailSent: true,
      loginToken: issued.loginToken,
      message: GENERIC_MESSAGE,
      expiresAt: issued.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[admin/auth/request-code]", err);
    const msg = Error.isError(err) ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        configured: Boolean(loginEmail),
        emailSent: false,
        message: "Could not start sign-in. Try again shortly.",
        ...(isDev ? { devHint: msg } : {}),
      },
      { status: isDev ? 503 : 500 },
    );
  }
}
