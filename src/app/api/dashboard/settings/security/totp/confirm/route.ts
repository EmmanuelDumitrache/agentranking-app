import { NextRequest } from "next/server";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeSecurityAudit } from "@/lib/account-security/audit";
import { generateBackupCodes, hashBackupCodes } from "@/lib/account-security/backup-codes";
import { encryptTotpSecret } from "@/lib/account-security/encrypt-secret";
import { getMfaFactorFlags } from "@/lib/account-security/flags";
import { matchTotpCode } from "@/lib/account-security/totp";
import { prisma } from "@/lib/db";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.mfaVerified === false) {
    return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return securityJsonResponse({ error: "Profile not found" }, { status: 404 });
  }
  if (getMfaFactorFlags(profile).totpEnabled) {
    return securityJsonResponse({ error: "Authenticator is already enabled" }, { status: 400 });
  }

  let body: { secret?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return securityJsonResponse({ error: "Invalid request" }, { status: 400 });
  }
  const secret = body.secret?.trim() ?? "";
  const code = body.code?.trim() ?? "";
  if (!secret || !code) {
    return securityJsonResponse({ error: "Secret and code are required" }, { status: 400 });
  }
  const matched = matchTotpCode(secret, code);
  if (!matched.ok) {
    return securityJsonResponse({ error: "Invalid authenticator code" }, { status: 400 });
  }

  const backupCodes = generateBackupCodes();
  const hashes = await hashBackupCodes(backupCodes);
  const enabled = await prisma.$transaction(async (tx) => {
    const updated = await tx.userProfile.updateMany({
      where: {
        id: profile.id,
        totpEnabledAt: null,
        totpSecretEnc: null,
      },
      data: {
        totpEnabledAt: new Date(),
        totpSecretEnc: encryptTotpSecret(secret),
        totpBackupCodesHash: hashes,
        totpLastUsedStep: matched.step,
        mfaTrustVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) return false;
    await writeSecurityAudit({
      userProfileId: profile.id,
      action: "totp_enroll",
      metadata: { backupCodes: backupCodes.length },
    }, tx);
    return true;
  });
  if (!enabled) {
    return securityJsonResponse({ error: "Authenticator setup changed; start again" }, { status: 409 });
  }
  return securityJsonResponse(
    { ok: true, backupCodes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
