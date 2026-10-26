import { writeSecurityAudit } from "@/lib/account-security/audit";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  const accountId = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(accountId)) {
    return securityJsonResponse({ error: "Invalid id" }, { status: 400 });
  }
  const profile = await prisma.userProfile.findUnique({ where: { id: accountId } });
  if (!profile) return securityJsonResponse({ error: "Account not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.userProfile.update({
      where: { id: accountId },
      data: {
        emailOtpMfaEnabledAt: null,
        mfaTrustVersion: { increment: 1 },
      },
    });
    await writeSecurityAudit({
      userProfileId: accountId,
      action: "admin_email_otp_disable",
      actor: "admin",
    }, tx);
  });
  return securityJsonResponse({ ok: true });
}
