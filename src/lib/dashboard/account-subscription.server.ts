import "server-only";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import {
  computeDashboardEntitlement,
  dashboardEntitlementIsUnlocked,
} from "@/lib/dashboard/access";
import {
  dashboardAccessPlanLabel,
  dashboardHasPremiumAccess,
} from "@/lib/dashboard/access-display";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { holderTierJson } from "@/lib/ar-holder-tier-resolve";
export type DashboardSubscriptionDto = {
  subscriptionStatus: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: string | null;
  subscriptionStartedAt: string | null;
  dashboardUnlocked: boolean;
  dashboardFullAccess?: boolean;
  dashboardAccessSource?: string;
  dashboardTier?: ReturnType<typeof holderTierJson> | null;
  dashboardFeatures?: string[];
  displayPlanLabel?: string;
  isPremiumAccess?: boolean;
  premiumVia?: string;
  needsOnboarding?: boolean;
};
const EMPTY_SUBSCRIPTION: DashboardSubscriptionDto = {
  subscriptionStatus: "none",
  subscriptionPlan: "",
  subscriptionExpiresAt: null,
  subscriptionStartedAt: null,
  dashboardUnlocked: false,
};
export async function loadDashboardSubscription(
  session?: Session | null,
): Promise<DashboardSubscriptionDto> {
  const resolved = session === undefined ? await getCachedDashboardSession() : session;
  if (!hasDashboardSessionIdentity(resolved) || resolved?.user?.mfaVerified === false) {
    throw new Error("Unauthorized");
  }
  const profileIdentity = await getDashboardUserProfile(resolved);
  if (!profileIdentity) return { ...EMPTY_SUBSCRIPTION, needsOnboarding: true };
  const profile = await prisma.userProfile.findUnique({
    where: { id: profileIdentity.id },
    select: {
      subscriptionStatus: true,
      subscriptionPlan: true,
      subscriptionExpiresAt: true,
      subscriptionStartedAt: true,
      walletAddress: true,
      solanaWallet: true,
    },
  });
  if (!profile) return EMPTY_SUBSCRIPTION;
  const entitlement = await computeDashboardEntitlement(profile, profileIdentity.id);
  const dashboardUnlocked = dashboardEntitlementIsUnlocked(entitlement);
  return {
    subscriptionStatus: profile.subscriptionStatus,
    subscriptionPlan: profile.subscriptionPlan,
    subscriptionExpiresAt: profile.subscriptionExpiresAt?.toISOString() ?? null,
    subscriptionStartedAt: profile.subscriptionStartedAt?.toISOString() ?? null,
    dashboardUnlocked,
    dashboardFullAccess: entitlement.full,
    dashboardAccessSource: entitlement.source,
    dashboardTier: entitlement.tier ? holderTierJson(entitlement.tier) : null,
    dashboardFeatures: Array.from(entitlement.features),
    displayPlanLabel: dashboardAccessPlanLabel({
      dashboardAccessSource: entitlement.source,
      dashboardTier: entitlement.tier,
      subscriptionPlan: profile.subscriptionPlan,
      dashboardUnlocked,
    }),
    isPremiumAccess: dashboardHasPremiumAccess(entitlement.source, entitlement.tier),
    premiumVia: entitlement.source,
  };
}
