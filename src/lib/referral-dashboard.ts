import "server-only";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { findActiveArReferralCodeForOwner } from "@/lib/referral-db";
import { normalizeReferralOwnerWallet } from "@/lib/referral-owner-wallet";
export type DashboardReferralStatsDto = {
  code: string | null;
  referralLink: string | null;
  totalReferrals: number;
  totalEarningsUsd: number;
  pendingEarningsUsd: number;
  approvedEarningsUsd: number;
  paidEarningsUsd: number;
  walletLinked: boolean;
};
const EMPTY_STATS: DashboardReferralStatsDto = {
  code: null,
  referralLink: null,
  totalReferrals: 0,
  totalEarningsUsd: 0,
  pendingEarningsUsd: 0,
  approvedEarningsUsd: 0,
  paidEarningsUsd: 0,
  walletLinked: false,
};
export async function loadDashboardReferralStats(
  session?: Session | null,
): Promise<DashboardReferralStatsDto> {
  const resolved = session === undefined ? await getCachedDashboardSession() : session;
  if (!hasDashboardSessionIdentity(resolved) || resolved?.user?.mfaVerified === false) {
    throw new Error("Unauthorized");
  }
  const profile = await getDashboardUserProfile(resolved);
  if (!profile) return EMPTY_STATS;
  const walletRaw = profile.solanaWallet?.trim() || profile.walletAddress?.trim() || "";
  const wallet = normalizeReferralOwnerWallet(walletRaw);
  let refCode = await prisma.arReferralCode.findFirst({
    where: { userProfileId: profile.id, isActive: true },
    select: { id: true, code: true },
  });
  if (!refCode && wallet) {
    refCode = await findActiveArReferralCodeForOwner(prisma, wallet, walletRaw);
  }
  if (!refCode) {
    return { ...EMPTY_STATS, walletLinked: Boolean(wallet) };
  }
  const [totalReferrals, commissions] = await Promise.all([
    prisma.arReferralEvent.count({
      where: { referralCodeId: refCode.id, conversionStatus: "qualified" },
    }),
    prisma.arReferralCommission.findMany({
      where: { referralCodeId: refCode.id },
      select: { status: true, commissionUsd: true },
    }),
  ]);
  const amountFor = (status: string) =>
    commissions
      .filter((row) => row.status === status)
      .reduce((sum, row) => sum + row.commissionUsd, 0);
  const pendingEarningsUsd = amountFor("pending");
  const approvedEarningsUsd = amountFor("approved");
  const paidEarningsUsd = amountFor("paid");
  const roundUsd = (value: number) => Math.round(value * 100) / 100;
  return {
    code: refCode.code,
    referralLink: `/r/${refCode.code}`,
    totalReferrals,
    totalEarningsUsd: roundUsd(approvedEarningsUsd + paidEarningsUsd),
    pendingEarningsUsd: roundUsd(pendingEarningsUsd),
    approvedEarningsUsd: roundUsd(approvedEarningsUsd),
    paidEarningsUsd: roundUsd(paidEarningsUsd),
    walletLinked: Boolean(wallet),
  };
}
