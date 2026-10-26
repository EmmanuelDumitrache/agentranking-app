import { NextRequest, NextResponse } from "next/server";
import { establishAdminSessionOnResponse } from "@/lib/admin-auth-establish-session";
import { verifyAdminLoginToken } from "@/lib/admin-login-token";
export const dynamic = "force-dynamic";
/**
 * GET /api/admin/auth/complete?t=SIGNED_TOKEN
 * One-shot server sign-in from the email button (no client JS required).
 */
export async function GET(request: NextRequest) {
  const loginToken = request.nextUrl.searchParams.get("t")?.trim() ?? "";
  const origin = request.nextUrl.origin;
  if (!loginToken) {
    return NextResponse.redirect(new URL("/admin/login?error=invalid", origin));
  }
  const verified = verifyAdminLoginToken(loginToken);
  if (!verified.ok) {
    const err = verified.reason === "expired" ? "expired" : "invalid";
    return NextResponse.redirect(new URL(`/admin/login?error=${err}`, origin));
  }
  const response = NextResponse.redirect(new URL("/admin", origin));
  try {
    await establishAdminSessionOnResponse(request, response, verified.rememberMe);
    return response;
  } catch (err) {
    console.error("[admin/auth/complete]", err);
    return NextResponse.redirect(new URL("/admin/login?error=failed", origin));
  }
}