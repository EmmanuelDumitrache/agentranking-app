import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { isAccountVerifiedStatus } from "@/lib/verification/account-verification-types";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import {
  buildOwnedAgentsWhere,
  isAgentVerifiedForDashboard,
} from "@/lib/dashboard/agent-ownership";
import { isDashboardAgentVerified } from "@/lib/dashboard/agent-verification-display";
import {
  ensureMinimalUserProfile,
  getDashboardUserProfile,
  hasDashboardIdentity,
} from "@/lib/dashboard/session-profile";
import type { ArHolderTier } from "@/lib/ar-holder-perk-config";
import { unlockedStakeTierForWallet } from "@/lib/ar-holder-tier-resolve";
import {
  dashboardFeaturesForTier,
  type DashboardFeature,
} from "@/lib/dashboard/feature-access";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import { classifyWallet } from "@/lib/trust-oracle-logic";
export type DashboardAgentSummary = {
  id: number;
  agentId: number;
  chainId: number;
  listingRegistrySource: string;
  name: string;
  image: string;
  description: string | null;
  score: number;
  protocolTrustScore: number;
  isVerified: boolean;
  isPremiumVerified: boolean;
  isVerifiedRevenue: boolean;
  sapVerified: boolean;
  publicVerificationStatus: string;
  arVerificationStatus: string;
  solanaAssetAddress: string | null;
  solanaCanonicalStatus: string | null;
  isActive: boolean;
  lastActiveAt: Date;
  chatSettings: { currentRevision: { enabled: boolean } | null } | null;
};
export type DashboardAccessState = {
  signedIn: boolean;
  profileId: number | null;
  ownedAgents: DashboardAgentSummary[];
  verifiedAgents: DashboardAgentSummary[];
  accountIsVerified: boolean;
  canManage: boolean;
  needsVerification: boolean;
};
const dashboardAgentSelect = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  image: true,
  description: true,
  score: true,
  protocolTrustScore: true,
  isVerified: true,
  isPremiumVerified: true,
  isVerifiedRevenue: true,
  sapVerified: true,
  publicVerificationStatus: true,
  arVerificationStatus: true,
  lastActiveAt: true,
  listingRegistrySource: true,
  isActive: true,
  solanaAssetAddress: true,
  solanaCanonicalStatus: true,
  chatSettings: { select: { currentRevision: { select: { enabled: true } } } },
} as const;
export async function getDashboardAccess(
  session: Session | null,
): Promise<DashboardAccessState> {
  const signedIn = hasDashboardIdentity(session);
  if (!signedIn) {
    return {
      signedIn: false,
      profileId: null,
      ownedAgents: [],
      verifiedAgents: [],
      accountIsVerified: false,
      canManage: false,
      needsVerification: false,
    };
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return {
      signedIn: true,
      profileId: null,
      ownedAgents: [],
      verifiedAgents: [],
      accountIsVerified: false,
      canManage: false,
      needsVerification: true,
    };
  }

  const appAccount = await prisma.appAccount.findUnique({
    where: { userProfileId: profile.id },
    select: {
      verificationStatus: true,
      verificationExpiresAt: true,
    },
  });
  const accountVerified = appAccount
    ? isAccountVerifiedStatus(
        appAccount.verificationStatus,
        appAccount.verificationExpiresAt,
      )
    : false;

  const ownedAgentsRaw = await prisma.agent.findMany({
    where: {
      AND: [
        { isActive: true },
        buildOwnedAgentsWhere({
          id: profile.id,
          walletAddress: profile.walletAddress,
          solanaWallet: profile.solanaWallet,
        }),
      ],
    },
    select: dashboardAgentSelect,
    orderBy: [
      { isPremiumVerified: "desc" },
      { isVerified: "desc" },
      { score: "desc" },
    ],
  });

  const ownedAgents = ownedAgentsRaw;

  const verifiedAgents = ownedAgents.filter((agent) =>
    isAgentVerifiedForDashboard(agent, accountVerified),
  );
  return {
    signedIn: true,
    profileId: profile.id,
    ownedAgents,
    verifiedAgents,
    accountIsVerified: accountVerified,
    canManage: verifiedAgents.length > 0,
    needsVerification: ownedAgents.length === 0 || verifiedAgents.length === 0,
  };
}
export function agentManageableWithoutVerification(agent: {
  listingRegistrySource: string;
  chainId: number;
}): boolean {
  return isAgentRankingNativeAgent(agent);
}
export async function assertDashboardAgentAccess(
  session: Session | null,
  agentDbId: number,
): Promise<
  | { ok: true; agent: DashboardAgentSummary }
  | { ok: false; status: 401 | 403 | 404 }
> {
  if (!hasDashboardIdentity(session)) return { ok: false, status: 401 };
  const profile = await getDashboardUserProfile(session);
  if (!profile) return { ok: false, status: 403 };
  const agent = await prisma.agent.findFirst({
    where: {
      AND: [
        { id: agentDbId },
        { isActive: true },
        buildOwnedAgentsWhere(profile),
      ],
    },
    select: dashboardAgentSelect,
  });
  if (!agent) return { ok: false, status: 404 };

  const appAccount = profile.id
    ? await prisma.appAccount.findUnique({
        where: { userProfileId: profile.id },
        select: {
          verificationStatus: true,
          verificationExpiresAt: true,
        },
      })
    : null;
  const accountVerified = appAccount
    ? isAccountVerifiedStatus(
        appAccount.verificationStatus,
        appAccount.verificationExpiresAt,
      )
    : false;

  if (
    !agentManageableWithoutVerification(agent) &&
    !isDashboardAgentVerified(agent, accountVerified)
  ) {
    return { ok: false, status: 403 };
  }
  return { ok: true, agent };
}
type SubscriptionStateFields = {
  subscriptionStatus: string;
  subscriptionExpiresAt: Date | null;
};
type DashboardEntitlementProfileFields = SubscriptionStateFields & {
  walletAddress: string | null;
  solanaWallet: string | null;
};
type BountyEligibilityProfileFields = SubscriptionStateFields & {
  walletAddress: string | null;
};
export type DashboardEntitlement = {
  full: boolean;
  tier: ArHolderTier | null;
  features: ReadonlySet<DashboardFeature>;
  source: "pro" | "sap" | "stake" | "none";
};
export type DashboardApiAccessResult =
  | { ok: true; profileId: number }
  | { ok: false; status: 401 | 403 };
export type DashboardApiFeatureResult =
  | { ok: true; profileId: number; entitlement: DashboardEntitlement }
  | { ok: false; status: 401 | 403 };
async function hasSapOperatorClaim(
  userProfileId: number | null | undefined,
): Promise<boolean> {
  if (userProfileId == null) return false;
  const count = await prisma.sapAgentOperatorClaim.count({ where: { userProfileId } });
  return count > 0;
}
export function isProSubscriber(profile: SubscriptionStateFields): boolean {
  if (profile.subscriptionStatus !== "active") return false;
  if (!profile.subscriptionExpiresAt) return true;
  return profile.subscriptionExpiresAt.getTime() > Date.now();
}
export async function isVerifiedAgent(
  walletRaw: string | null | undefined,
): Promise<boolean> {
  const wallet = walletRaw?.trim() ?? "";
  const walletKind = classifyWallet(wallet);
  if (!walletKind) return false;
  const normalized = walletKind === "evm" ? wallet.toLowerCase() : wallet;
  const ownerWhere = walletKind === "evm"
    ? { owner: { equals: normalized, mode: "insensitive" as const } }
    : { owner: normalized };
  const verifiedWalletWhere = walletKind === "evm"
    ? { verifiedWallet: { equals: normalized, mode: "insensitive" as const } }
    : { verifiedWallet: normalized };
  const count = await prisma.agent.count({
    where: {
      AND: [
        { OR: [{ isVerified: true }, { isPremiumVerified: true }] },
        { OR: [ownerWhere, { AND: [{ verifiedWallet: { not: "" } }, verifiedWalletWhere] }] },
      ],
    },
  });
  return count > 0;
}
export async function computeDashboardEntitlement(
  profile: DashboardEntitlementProfileFields | null,
  userProfileId?: number | null,
): Promise<DashboardEntitlement> {
  if (!profile) {
    return { full: false, tier: null, features: new Set(), source: "none" };
  }
  if (isProSubscriber(profile)) {
    return {
      full: true,
      tier: null,
      features: new Set<DashboardFeature>([
        "referral_tools",
        "dashboard_previews",
        "alerts",
        "compare",
        "refresh_lanes",
        "exports",
        "mcp",
        "perf_snapshots",
      ]),
      source: "pro",
    };
  }
  if (await hasSapOperatorClaim(userProfileId)) {
    return {
      full: true,
      tier: null,
      features: new Set<DashboardFeature>([
        "referral_tools",
        "dashboard_previews",
        "alerts",
        "compare",
        "refresh_lanes",
        "exports",
        "mcp",
        "perf_snapshots",
      ]),
      source: "sap",
    };
  }
  const wallet = normalizeSolanaAddress(
    profile.solanaWallet ?? profile.walletAddress ?? "",
  );
  if (wallet) {
    try {
      const { tier } = await unlockedStakeTierForWallet(wallet);
      if (tier) {
        const features = dashboardFeaturesForTier(tier);
        return {
          full: tier.id === "core",
          tier,
          features,
          source: "stake",
        };
      }
    } catch (error) {
      console.error("[dashboard-access] stake tier lookup failed:", error);
    }
  }
  return { full: false, tier: null, features: new Set(), source: "none" };
}
export function dashboardEntitlementIsUnlocked(
  entitlement: DashboardEntitlement,
): boolean {
  return entitlement.full || entitlement.features.size > 0;
}
export async function computeDashboardUnlocked(
  profile: DashboardEntitlementProfileFields | null,
  userProfileId?: number | null,
): Promise<boolean> {
  const entitlement = await computeDashboardEntitlement(profile, userProfileId);
  return dashboardEntitlementIsUnlocked(entitlement);
}
export function dashboardEntitlementHasFeature(
  entitlement: DashboardEntitlement,
  feature: DashboardFeature,
): boolean {
  return entitlement.full || entitlement.features.has(feature);
}
export async function requireDashboardAccessForApi(
  session: Session | null,
): Promise<DashboardApiAccessResult> {
  if (!session || !hasDashboardIdentity(session)) {
    return { ok: false, status: 401 };
  }
  const resolved = await getDashboardUserProfile(session);
  if (!resolved) {
    return { ok: false, status: 401 };
  }
  const profile = await prisma.userProfile.findUnique({
    where: { id: resolved.id },
    select: {
      subscriptionStatus: true,
      subscriptionExpiresAt: true,
      walletAddress: true,
      solanaWallet: true,
    },
  });
  if (!(await computeDashboardUnlocked(profile, resolved.id))) {
    return { ok: false, status: 403 };
  }
  return { ok: true, profileId: resolved.id };
}
export async function requireDashboardFeatureForApi(
  session: Session | null,
  feature: DashboardFeature,
): Promise<DashboardApiFeatureResult> {
  if (!session || !hasDashboardIdentity(session)) {
    return { ok: false, status: 401 };
  }
  const resolved = await getDashboardUserProfile(session);
  if (!resolved) {
    return { ok: false, status: 401 };
  }
  const profile = await prisma.userProfile.findUnique({
    where: { id: resolved.id },
    select: {
      subscriptionStatus: true,
      subscriptionExpiresAt: true,
      walletAddress: true,
      solanaWallet: true,
    },
  });
  const entitlement = await computeDashboardEntitlement(profile, resolved.id);
  if (!dashboardEntitlementHasFeature(entitlement, feature)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, profileId: resolved.id, entitlement };
}
export async function canClaimBounties(
  profile: BountyEligibilityProfileFields | null,
): Promise<boolean> {
  if (!profile) return false;
  if (isProSubscriber(profile)) return true;
  return isVerifiedAgent(profile.walletAddress);
}
