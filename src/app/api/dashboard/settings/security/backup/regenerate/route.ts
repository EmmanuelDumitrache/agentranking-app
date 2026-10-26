import { NextRequest } from "next/server";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeSecurityAudit } from "@/lib/account-security/audit";
import { generateBackupCodes, hashBackupCodes } from "@/lib/account-security/backup-codes";
import { getMfaFactorFlags } from "@/lib/account-security/flags";
import { verifyProfileMfaFactor } from "@/lib/account-security/verify-factor";
import { prisma } from "@/lib/db";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.mfaVerified === false) {
    return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) return securityJsonResponse({ error: "Profile not found" }, { status: 404 });
  if (!getMfaFactorFlags(profile).totpEnabled) {
    return securityJsonResponse({ error: "Authenticator is not enabled" }, { status: 400 });
  }

  let body: { method?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return securityJsonResponse({ error: "Invalid request" }, { status: 400 });
  }
  if (body.method !== "totp") {
    return securityJsonResponse(
      { error: "Enter a code from your authenticator app to regenerate backup codes" },
      { status: 400 },
    );
  }
  const verified = await verifyProfileMfaFactor({
    profileId: profile.id,
    method: "totp",
    code: body.code?.trim() ?? "",
    auditContext: "step_up",
  });
  if (!verified.ok) return securityJsonResponse({ error: verified.error }, { status: 401 });

  const backupCodes = generateBackupCodes();
  const hashes = await hashBackupCodes(backupCodes);
  await prisma.$transaction(async (tx) => {
    await tx.userProfile.update({
      where: { id: profile.id },
      data: {
        totpBackupCodesHash: hashes,
        mfaTrustVersion: { increment: 1 },
      },
    });
    await writeSecurityAudit({
      userProfileId: profile.id,
      action: "backup_regenerate",
      metadata: { via: verified.method, backupCodes: backupCodes.length },
    }, tx);
  });
  return securityJsonResponse(
    { ok: true, backupCodes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
