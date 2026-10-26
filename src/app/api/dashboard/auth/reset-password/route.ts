import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { dashboardAuthRegisterRateLimitOk } from "@/lib/dashboard/auth-rate-limit";
import { completeDashboardPasswordReset } from "@/lib/dashboard/auth-password-reset";
import { apiErrorResponse } from "@/lib/api-json-response";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  let body: { token?: string; password?: string; confirmPassword?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const token = body.token?.trim() ?? "";
  const password = body.password ?? "";
  const confirmPassword = body.confirmPassword ?? "";

  if (!token) {
    return NextResponse.json({ error: "Reset link is invalid." }, { status: 400 });
  }

  if (!(await dashboardAuthRegisterRateLimitOk(ip, token))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  try {
    const result = await completeDashboardPasswordReset({ token, password, confirmPassword });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      message: "Password updated. You can sign in with your new password.",
      email: result.email,
    });
  } catch (err) {
    return apiErrorResponse(err, "[dashboard/auth/reset-password]", "Could not reset password.");
  }
}
