import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { dashboardAuthRegisterRateLimitOk } from "@/lib/dashboard/auth-rate-limit";
import { registerDashboardAccount } from "@/lib/dashboard/auth-register";
import {
  isStrongEnoughPassword,
  isValidEmail,
  passwordsMatch,
} from "@/lib/dashboard/auth-validate";
import { normalizeDashboardEmail } from "@/lib/dashboard/auth-users";
import { apiErrorResponse } from "@/lib/api-json-response";
export const dynamic = "force-dynamic";
const GENERIC_OK = {
  ok: true,
  message: "If this email can be registered, check your inbox to confirm your account.",
};
export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  let body: { email?: string; password?: string; confirmPassword?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = normalizeDashboardEmail(body.email ?? "");
  const password = body.password ?? "";
  const confirmPassword = body.confirmPassword ?? "";
  if (!isValidEmail(email)) {
    return NextResponse.json(GENERIC_OK);
  }
  if (!(await dashboardAuthRegisterRateLimitOk(ip, email))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }
  if (!isStrongEnoughPassword(password) || !passwordsMatch(password, confirmPassword)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters and match confirmation." },
      { status: 400 },
    );
  }
  try {
    const result = await registerDashboardAccount({ email, password });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json(GENERIC_OK);
  } catch (err) {
    return apiErrorResponse(err, "[dashboard/auth/register]", "Could not create account.");
  }
}
