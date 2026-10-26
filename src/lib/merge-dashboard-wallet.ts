import type { Prisma } from "@/generated/prisma/client";
import { isProSubscriber } from "@/lib/dashboard/access";
/** Minimal fields for subscription merge when linking a wallet already tied to another UserProfile row. */
export type WalletMergeProfile = {
  id: number;
  email: string | null;
  subscriptionStatus: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: Date | null;
  subscriptionStartedAt: Date | null;
  helioSubscriptionId: string | null;
};
function subActiveSlice(p: WalletMergeProfile) {
  return {
    subscriptionStatus: p.subscriptionStatus,
    subscriptionExpiresAt: p.subscriptionExpiresAt,
    walletAddress: null as string | null,
  };
}
/**
 * When the donor row (admin / wallet-only account) has a better subscription than the signed-in row,
 * copy subscription fields onto the primary (email) row after the wallet unique is moved.
 */
export function subscriptionPatchFromDonor(
  primary: WalletMergeProfile,
  donor: WalletMergeProfile
): Pick<
  Prisma.UserProfileUpdateInput,
  | "subscriptionStatus"
  | "subscriptionPlan"
  | "subscriptionExpiresAt"
  | "subscriptionStartedAt"
  | "helioSubscriptionId"
> {
  const pActive = isProSubscriber(subActiveSlice(primary));
  const dActive = isProSubscriber(subActiveSlice(donor));
  if (dActive && !pActive) {
    return {
      subscriptionStatus: donor.subscriptionStatus,
      subscriptionPlan: donor.subscriptionPlan,
      subscriptionExpiresAt: donor.subscriptionExpiresAt,
      subscriptionStartedAt: donor.subscriptionStartedAt,
      helioSubscriptionId: donor.helioSubscriptionId,
    };
  }
  if (dActive && pActive) {
    const pe = primary.subscriptionExpiresAt?.getTime() ?? 0;
    const de = donor.subscriptionExpiresAt?.getTime() ?? 0;
    if (de > pe) {
      return {
        subscriptionStatus: donor.subscriptionStatus,
        subscriptionPlan: donor.subscriptionPlan,
        subscriptionExpiresAt: donor.subscriptionExpiresAt,
        subscriptionStartedAt: donor.subscriptionStartedAt,
        helioSubscriptionId: donor.helioSubscriptionId,
      };
    }
  }
  if (!pActive && donor.subscriptionStatus === "pending") {
    return {
      subscriptionStatus: donor.subscriptionStatus,
      subscriptionPlan: donor.subscriptionPlan,
      subscriptionExpiresAt: donor.subscriptionExpiresAt,
      subscriptionStartedAt: donor.subscriptionStartedAt,
      helioSubscriptionId: donor.helioSubscriptionId,
    };
  }
  return {};
}
