import { NextRequest } from "next/server";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import {
  issueDashboardLoginToken,
  revokeDashboardLoginToken,
} from "@/lib/dashboard/login-token";
import { sendDashboardLoginEmail } from "@/lib/dashboard/email-auth";
export const dynamic = "force-dynamic";
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  const accountId = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(accountId)) {
    return securityJsonResponse({ error: "Invalid id" }, { status: 400 });
  }
  const profile = await prisma.userProfile.findUnique({
    where: { id: accountId },
    select: { email: true },
  });
  if (!profile?.email) {
    return securityJsonResponse({ error: "Account has no email." }, { status: 400 });
  }
  const issued = await issueDashboardLoginToken(profile.email, { purpose: "sign_in" });
  const sent = await sendDashboardLoginEmail({
    email: profile.email,
    code: issued.code,
    completeUrl: issued.completeUrl,
  });
  if (!sent.sent) {
    await revokeDashboardLoginToken(issued.loginToken);
    return securityJsonResponse(
      { error: sent.error ?? "Failed to send email." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  return securityJsonResponse({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}