import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeSecurityAudit } from "@/lib/account-security/audit";
import { consumeBackupCode } from "@/lib/account-security/backup-codes";
import { decryptTotpSecret } from "@/lib/account-security/encrypt-secret";
import { getMfaFactorFlags, type ProfileMfaFields } from "@/lib/account-security/flags";
import { matchTotpCode } from "@/lib/account-security/totp";
import { verifyDashboardLoginCode } from "@/lib/dashboard/login-token";

export type StepUpMethod = "totp" | "backup" | "email";
export type StepUpResult =
  | { ok: true; method: StepUpMethod }
  | { ok: false; error: string };

type LockedMfaProfile = ProfileMfaFields & {
  id: number;
  totpLastUsedStep: bigint | null;
};

async function lockMfaProfile(
  tx: Prisma.TransactionClient,
  profileId: number,
): Promise<LockedMfaProfile | null> {
  const rows = await tx.$queryRaw<LockedMfaProfile[]>`
    SELECT
      "id",
      "totp_enabled_at" AS "totpEnabledAt",
      "totp_secret_enc" AS "totpSecretEnc",
      "totp_backup_codes_hash" AS "totpBackupCodesHash",
      "totp_last_used_step" AS "totpLastUsedStep",
      "email_otp_mfa_enabled_at" AS "emailOtpMfaEnabledAt",
      "email",
      "email_verified_at" AS "emailVerifiedAt"
    FROM "UserProfile"
    WHERE "id" = ${profileId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function auditActions(context: "mfa_challenge" | "step_up") {
  return context === "mfa_challenge"
    ? { fail: "mfa_challenge_fail" as const, ok: "mfa_challenge_ok" as const }
    : { fail: "step_up_fail" as const, ok: "step_up_ok" as const };
}

/** Verify an MFA factor. TOTP steps and backup codes are consumed atomically. */
export async function verifyProfileMfaFactor(input: {
  profileId: number;
  method: StepUpMethod;
  code: string;
  loginToken?: string;
  auditContext?: "mfa_challenge" | "step_up";
}): Promise<StepUpResult> {
  const context = input.auditContext ?? "step_up";
  const actions = auditActions(context);

  if (input.method === "email") {
    const current = await prisma.userProfile.findUnique({ where: { id: input.profileId } });
    if (!current) return { ok: false, error: "Account not found" };
    if (!getMfaFactorFlags(current).emailOtpMfaEnabled) {
      await writeSecurityAudit({
        userProfileId: input.profileId,
        action: actions.fail,
        metadata: { method: "email", reason: "not_enabled" },
      });
      return { ok: false, error: "Email codes are not enabled" };
    }
    const loginToken = input.loginToken?.trim() ?? "";
    if (!loginToken) return { ok: false, error: "Missing login token" };
    const verified = await verifyDashboardLoginCode(loginToken, input.code, {
      purpose: "mfa",
      consume: true,
    });
    if (!verified.ok || verified.email !== (current.email?.trim().toLowerCase() ?? "")) {
      await writeSecurityAudit({
        userProfileId: input.profileId,
        action: actions.fail,
        metadata: {
          method: "email",
          reason: verified.ok ? "email_mismatch" : verified.reason,
        },
      });
      return { ok: false, error: "Invalid code" };
    }
    await writeSecurityAudit({
      userProfileId: input.profileId,
      action: actions.ok,
      metadata: { method: "email" },
    });
    return { ok: true, method: "email" };
  }

  return prisma.$transaction(async (tx) => {
    const profile = await lockMfaProfile(tx, input.profileId);
    if (!profile) return { ok: false, error: "Account not found" };
    const flags = getMfaFactorFlags(profile);

    if (input.method === "totp") {
      if (!flags.totpEnabled || !profile.totpSecretEnc) {
        await writeSecurityAudit({
          userProfileId: input.profileId,
          action: actions.fail,
          metadata: { method: "totp", reason: "not_enabled" },
        }, tx);
        return { ok: false, error: "Authenticator is not enabled" };
      }
      const matched = matchTotpCode(decryptTotpSecret(profile.totpSecretEnc), input.code);
      if (!matched.ok || (profile.totpLastUsedStep !== null && matched.step <= profile.totpLastUsedStep)) {
        await writeSecurityAudit({
          userProfileId: input.profileId,
          action: actions.fail,
          metadata: { method: "totp", reason: matched.ok ? "replayed" : "invalid" },
        }, tx);
        return { ok: false, error: "Invalid code" };
      }
      await tx.userProfile.update({
        where: { id: input.profileId },
        data: { totpLastUsedStep: matched.step },
      });
      await writeSecurityAudit({
        userProfileId: input.profileId,
        action: actions.ok,
        metadata: { method: "totp" },
      }, tx);
      return { ok: true, method: "totp" };
    }

    if (!flags.totpEnabled || profile.totpBackupCodesHash.length === 0) {
      await writeSecurityAudit({
        userProfileId: input.profileId,
        action: actions.fail,
        metadata: { method: "backup", reason: "none" },
      }, tx);
      return { ok: false, error: "No backup codes available" };
    }
    const remaining = await consumeBackupCode(profile.totpBackupCodesHash, input.code);
    if (!remaining) {
      await writeSecurityAudit({
        userProfileId: input.profileId,
        action: actions.fail,
        metadata: { method: "backup", reason: "invalid" },
      }, tx);
      return { ok: false, error: "Invalid code" };
    }
    await tx.userProfile.update({
      where: { id: input.profileId },
      data: { totpBackupCodesHash: remaining },
    });
    await writeSecurityAudit({
      userProfileId: input.profileId,
      action: actions.ok,
      metadata: { method: "backup", remaining: remaining.length },
    }, tx);
    return { ok: true, method: "backup" };
  });
}
