import "server-only";
import type { Session } from "next-auth";
import { loadAppAccountSummary } from "@/lib/app-account-summary";
import {
  getMfaFactorFlags,
  isRealDashboardEmail,
  profileCanUseEmailOtpMfa,
} from "@/lib/account-security/flags";
import { getMfaDeviceTrust } from "@/lib/account-security/mfa-trust";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import {
  isDisplaySyntheticEmail,
  isTwitterAuthConfigured,
  listLinkedOAuthProviders,
} from "@/lib/oauth-account-link";
export class DashboardAccountReadError extends Error {
  constructor(
    readonly status: 401 | 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = "DashboardAccountReadError";
  }
}
export type DashboardAccountSettingsDto = {
  displayName: string;
  email: string | null;
  accountId: string | null;
  accountWalletPublicKey: string | null;
  accountWalletSolscanUrl: string | null;
  platformCredits: number;
  llmBalanceCents: number;
  totalBalance: number;
  totalCredits: number;
  agentCount: number;
  maxAgents: number;
  walletProvisionError: string | null;
  linkedProviders: {
    google: boolean;
    twitter: boolean;
    twitterUsername: string | null;
  };
  twitterAuthAvailable: boolean;
};
export type DashboardTrustedDeviceDto = {
  active: boolean;
  expiresAt: string | null;
};
export type DashboardSecurityStatusDto = {
  totpEnabled: boolean;
  emailOtpMfaEnabled: boolean;
  backupCodesRemaining: number;
  mfaRequired: boolean;
  canEnableEmailOtp: boolean;
  emailVerified: boolean;
  email: string | null;
  trustedDevice: DashboardTrustedDeviceDto;
};
async function resolveReadableSession(session?: Session | null): Promise<Session> {
  const resolved = session === undefined ? await getCachedDashboardSession() : session;
  if (!resolved || !hasDashboardSessionIdentity(resolved) || resolved.user?.mfaVerified === false) {
    throw new DashboardAccountReadError(401, "Unauthorized");
  }
  return resolved;
}
export async function loadDashboardAccountSettings(
  session?: Session | null,
): Promise<DashboardAccountSettingsDto> {
  const resolved = await resolveReadableSession(session);
  const summary = await loadAppAccountSummary(resolved);
  if (!summary) {
    throw new DashboardAccountReadError(500, "Account summary unavailable");
  }
  const authUserId =
    (resolved.user as { id?: string } | undefined)?.id?.trim() || null;
  const sessionEmail = resolved.user?.email?.trim() || summary.email;
  const linked = await listLinkedOAuthProviders(authUserId, sessionEmail);
  const displayEmail =
    summary.email && !isDisplaySyntheticEmail(summary.email) ? summary.email : null;
  return {
    displayName: summary.displayName,
    email: displayEmail,
    accountId: summary.accountId,
    accountWalletPublicKey: summary.accountWalletPublicKey,
    accountWalletSolscanUrl: summary.accountWalletSolscanUrl,
    platformCredits: summary.platformCredits,
    llmBalanceCents: summary.llmBalanceCents,
    totalBalance: summary.totalBalance,
    totalCredits: summary.totalBalance,
    agentCount: summary.agentCount,
    maxAgents: summary.maxAgents,
    walletProvisionError: summary.walletProvisionError,
    linkedProviders: {
      google: linked.google,
      twitter: linked.twitter,
      twitterUsername: linked.twitterUsername,
    },
    twitterAuthAvailable: isTwitterAuthConfigured(),
  };
}
export async function loadDashboardSecurityStatus(
  session?: Session | null,
): Promise<DashboardSecurityStatusDto> {
  const resolved = await resolveReadableSession(session);
  const profile = await getDashboardUserProfile(resolved);
  if (!profile) {
    throw new DashboardAccountReadError(404, "Profile not found");
  }
  const flags = getMfaFactorFlags(profile);
  const realEmail = profile.email && isRealDashboardEmail(profile.email) ? profile.email : null;
  const trustedDevice = await getMfaDeviceTrust(profile.id, profile.mfaTrustVersion);
  return {
    totpEnabled: flags.totpEnabled,
    emailOtpMfaEnabled: flags.emailOtpMfaEnabled,
    backupCodesRemaining: flags.backupCodesRemaining,
    mfaRequired: flags.mfaRequired,
    canEnableEmailOtp: Boolean(realEmail) && !flags.emailOtpMfaEnabled,
    emailVerified: profileCanUseEmailOtpMfa(profile),
    email: realEmail,
    trustedDevice: {
      active: trustedDevice.active,
      expiresAt: trustedDevice.expiresAt,
    },
  };
}
