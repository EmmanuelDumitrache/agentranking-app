import { NextRequest, NextResponse } from "next/server";
import { establishAdminSessionOnResponse } from "@/lib/admin-auth-establish-session";
import { verifyAdminLoginCode } from "@/lib/admin-login-token";
import { adminLoginVerifyRateLimitOk } from "@/lib/admin-login-rate-limit";
import { getClientIp } from "@/lib/client-ip";
export const dynamic = "force-dynamic";
/**
 * POST /api/admin/auth/verify-code
 * Body: { code: string, loginToken: string, rememberMe?: boolean }
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  if (!(await adminLoginVerifyRateLimitOk(ip))) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }
  let code = "";
  let loginToken = "";
  let rememberMe = false;
  try {
    const body = (await request.json()) as {
      code?: string;
      loginToken?: string;
      rememberMe?: boolean;
    };
    code = (body.code ?? "").trim();
    loginToken = (body.loginToken ?? "").trim();
    rememberMe = body.rememberMe === true;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Enter the 6-digit code" }, { status: 400 });
  }
  if (!loginToken) {
    return NextResponse.json(
      { error: "Sign-in session expired. Request a new email." },
      { status: 400 },
    );
  }
  const result = verifyAdminLoginCode(loginToken, code);
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Code expired. Request a new sign-in email."
        : result.reason === "code_mismatch"
          ? "Invalid code. Check the email or request a new one."
          : "Invalid sign-in session. Request a new email.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  try {
    await establishAdminSessionOnResponse(request, response, rememberMe || result.rememberMe);
    return response;
  } catch (err) {
    console.error("[admin/auth/verify-code]", err);
    const message = Error.isError(err) ? err.message : "Sign-in failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
