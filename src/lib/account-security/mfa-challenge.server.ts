import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getMfaFactorFlags, profileCanUseEmailOtpMfa } from "@/lib/account-security/flags";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import type { MfaStatusDto } from "@/lib/account-security/mfa-types";
export type MfaStatusReadResult =
  | { ok: true; status: MfaStatusDto }
  | { ok: false; statusCode: 401 | 404; error: string };
export async function readMfaStatus(): Promise<MfaStatusReadResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { ok: false, statusCode: 401, error: "Unauthorized" };
  }
  const profile = await getDashboardUserProfile(session);
  if (!profile) {
    return { ok: false, statusCode: 404, error: "Profile not found" };
  }
  const flags = getMfaFactorFlags(profile);
  const canEnableEmailOtp = profileCanUseEmailOtpMfa(profile);
  return {
    ok: true,
    status: {
      mfaVerified: session.user.mfaVerified !== false,
      profileId: profile.id,
      totpEnabled: flags.totpEnabled,
      emailOtpMfaEnabled: flags.emailOtpMfaEnabled,
      backupCodesRemaining: flags.backupCodesRemaining,
      mfaRequired: flags.mfaRequired,
      canEnableEmailOtp,
      email: canEnableEmailOtp ? profile.email : null,
    },
  };
}
