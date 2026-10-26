import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { dashboardAuthResendConfirmRateLimitOk } from "@/lib/dashboard/auth-rate-limit";
import { resendDashboardConfirmEmail } from "@/lib/dashboard/auth-register";
import { isValidEmail } from "@/lib/dashboard/auth-validate";
import { normalizeDashboardEmail } from "@/lib/dashboard/auth-users";
import { apiErrorResponse } from "@/lib/api-json-response";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const session = await getServerSession(authOptions);
  let email = session?.user?.email ? normalizeDashboardEmail(session.user.email) : "";
  try {
    const body = (await request.json()) as { email?: string };
    if (body.email) email = normalizeDashboardEmail(body.email);
  } catch {
    // empty body ok when session has email
  }
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!(await dashboardAuthResendConfirmRateLimitOk(ip, email))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }
  try {
    const result = await resendDashboardConfirmEmail(email);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      message: "If an account exists and is unverified, we sent a new confirmation email.",
    });
  } catch (err) {
    return apiErrorResponse(err, "[dashboard/auth/resend-confirm]", "Could not resend confirmation email.");
  }
}
