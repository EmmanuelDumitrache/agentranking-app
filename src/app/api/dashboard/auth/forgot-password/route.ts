import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { dashboardAuthForgotPasswordRateLimitOk } from "@/lib/dashboard/auth-rate-limit";
import { requestDashboardPasswordReset } from "@/lib/dashboard/auth-password-reset";
import { isValidEmail } from "@/lib/dashboard/auth-validate";
import { normalizeDashboardEmail } from "@/lib/dashboard/auth-users";
import { apiErrorResponse } from "@/lib/api-json-response";

export const dynamic = "force-dynamic";

const GENERIC_OK = {
  ok: true,
  message: "If an account exists for this email, we sent a password reset link.",
};

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  let body: { email?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = normalizeDashboardEmail(body.email ?? "");
  if (!isValidEmail(email)) {
    return NextResponse.json(GENERIC_OK);
  }

  if (!(await dashboardAuthForgotPasswordRateLimitOk(ip, email))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  try {
    const result = await requestDashboardPasswordReset(email);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(GENERIC_OK);
  } catch (err) {
    return apiErrorResponse(err, "[dashboard/auth/forgot-password]", "Could not send reset email.");
  }
}
