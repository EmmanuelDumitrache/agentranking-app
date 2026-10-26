import { isSyntheticXEmail } from "@/lib/oauth-account-link";

export type MfaFactorFlags = {
  totpEnabled: boolean;
  emailOtpMfaEnabled: boolean;
  backupCodesRemaining: number;
  mfaRequired: boolean;
};

export type ProfileMfaFields = {
  totpEnabledAt: Date | null;
  totpSecretEnc: string | null;
  totpBackupCodesHash: string[];
  emailOtpMfaEnabledAt: Date | null;
  email: string | null;
  emailVerifiedAt: Date | null;
};

const WALLET_EMAIL_SUFFIX = "@wallet.agentranking.io";

export function isRealDashboardEmail(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase() ?? "";
  if (!e || !e.includes("@")) return false;
  if (e.endsWith(WALLET_EMAIL_SUFFIX)) return false;
  if (isSyntheticXEmail(e)) return false;
  return true;
}

export function profileCanUseEmailOtpMfa(profile: {
  email: string | null;
  emailVerifiedAt: Date | null;
}): boolean {
  return Boolean(profile.emailVerifiedAt && isRealDashboardEmail(profile.email));
}

export function getMfaFactorFlags(profile: ProfileMfaFields): MfaFactorFlags {
  const totpEnabled = Boolean(profile.totpEnabledAt && profile.totpSecretEnc);
  const emailOtpMfaEnabled = Boolean(
    profile.emailOtpMfaEnabledAt && profileCanUseEmailOtpMfa(profile),
  );
  return {
    totpEnabled,
    emailOtpMfaEnabled,
    backupCodesRemaining: profile.totpBackupCodesHash.length,
    mfaRequired: totpEnabled || emailOtpMfaEnabled,
  };
}
