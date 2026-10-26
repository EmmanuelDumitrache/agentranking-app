import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { dashboardAuthRequestCodeRateLimitOk } from "@/lib/dashboard/auth-rate-limit";
import { issueDashboardLoginToken } from "@/lib/dashboard/login-token";
import { sendDashboardLoginEmail } from "@/lib/dashboard/email-auth";
import { isValidEmail } from "@/lib/dashboard/auth-validate";
import { normalizeDashboardEmail } from "@/lib/dashboard/auth-users";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const GENERIC_MESSAGE =
  "If an account exists for this email, we sent a sign-in code. It expires in 20 minutes.";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  let email = "";
  try {
    const body = (await request.json()) as { email?: string };
    email = normalizeDashboardEmail(body.email ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE }, { headers: NO_STORE });
  }
  if (!(await dashboardAuthRequestCodeRateLimitOk(ip, email))) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: NO_STORE },
    );
  }

  try {
    // Always return the same token-shaped response for syntactically valid addresses.
    // Unknown accounts receive a short-lived decoy token with the same verification
    // behaviour and response shape, preventing account enumeration through either API.
    const issued = await issueDashboardLoginToken(email, { purpose: "sign_in" });
    const profile = await prisma.userProfile.findUnique({
      where: { email },
      select: { id: true },
    });

    if (profile) {
      await sendDashboardLoginEmail({
        email,
        code: issued.code,
        completeUrl: issued.completeUrl,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        message: GENERIC_MESSAGE,
        loginToken: issued.loginToken,
        ...(process.env.NODE_ENV === "development" && profile
          ? { devCode: issued.code, devCompleteUrl: issued.completeUrl }
          : {}),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[dashboard/auth/request-code]", error);
    return NextResponse.json(
      { error: "Could not send sign-in email." },
      { status: 500, headers: NO_STORE },
    );
  }
}
