import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { buildOwnedAgentsWhere } from "@/lib/dashboard/agent-ownership";
import { getPublicSiteUrl } from "@/lib/site-url";
import { agentPublicPath, agentPublicUrl, toAgentUrlSlug } from "@/lib/agent-public-url";
import { requireAdminIdentity } from "./auth.server";
import type {
  AdminAccountAgentsResponse,
  AdminAccountDto,
  AdminAccountsResponse,
} from "./types";
import type { AdminAccountsQuery } from "./query";

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  walletAddress: true,
  displayName: true,
  username: true,
  subscriptionStatus: true,
  subscriptionPlan: true,
  subscriptionExpiresAt: true,
  subscriptionStartedAt: true,
  isClaimed: true,
  claimedAt: true,
  claimToken: true,
  claimTokenExpiresAt: true,
  adminNotes: true,
  createdAt: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  totpEnabledAt: true,
  emailOtpMfaEnabledAt: true,
} satisfies Prisma.UserProfileSelect;

type AccountRecord = Prisma.UserProfileGetPayload<{ select: typeof ACCOUNT_SELECT }>;

export function toAdminAccountDto(account: AccountRecord): AdminAccountDto {
  return {
    id: account.id,
    email: account.email,
    walletAddress: account.walletAddress,
    displayName: account.displayName,
    username: account.username,
    subscriptionStatus: account.subscriptionStatus,
    subscriptionPlan: account.subscriptionPlan,
    subscriptionExpiresAt: account.subscriptionExpiresAt?.toISOString() ?? null,
    subscriptionStartedAt: account.subscriptionStartedAt?.toISOString() ?? null,
    isClaimed: account.isClaimed,
    claimedAt: account.claimedAt?.toISOString() ?? null,
    claimToken: null,
    hasClaimToken: Boolean(account.claimToken),
    claimTokenExpiresAt: account.claimTokenExpiresAt?.toISOString() ?? null,
    adminNotes: account.adminNotes,
    createdAt: account.createdAt.toISOString(),
    emailVerifiedAt: account.emailVerifiedAt?.toISOString() ?? null,
    lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
    totpEnabledAt: account.totpEnabledAt?.toISOString() ?? null,
    emailOtpMfaEnabledAt: account.emailOtpMfaEnabledAt?.toISOString() ?? null,
  };
}

export async function readAdminAccounts(query: AdminAccountsQuery): Promise<AdminAccountsResponse> {
  await requireAdminIdentity();
  const where: Prisma.UserProfileWhereInput = {};
  if (query.status !== "all") where.subscriptionStatus = query.status;
  if (query.search) {
    where.OR = [
      { email: { contains: query.search, mode: "insensitive" } },
      { walletAddress: { contains: query.search, mode: "insensitive" } },
      { displayName: { contains: query.search, mode: "insensitive" } },
      { username: { contains: query.search, mode: "insensitive" } },
    ];
  }
  const [accounts, total] = await Promise.all([
    prisma.userProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      select: ACCOUNT_SELECT,
    }),
    prisma.userProfile.count({ where }),
  ]);
  return {
    accounts: accounts.map(toAdminAccountDto),
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
  };
}

export async function readAdminAccountById(accountId: number): Promise<AdminAccountDto | null> {
  await requireAdminIdentity();
  const account = await prisma.userProfile.findUnique({
    where: { id: accountId },
    select: ACCOUNT_SELECT,
  });
  return account ? toAdminAccountDto(account) : null;
}

export async function readAdminAccountAgents(accountId: number): Promise<AdminAccountAgentsResponse | null> {
  await requireAdminIdentity();
  const profile = await prisma.userProfile.findUnique({
    where: { id: accountId },
    select: { id: true, email: true, walletAddress: true, solanaWallet: true },
  });
  if (!profile) return null;
  const ownedAgents = await prisma.agent.findMany({
    where: buildOwnedAgentsWhere(profile),
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      isVerified: true,
      isPremiumVerified: true,
      isVerifiedRevenue: true,
    },
    orderBy: { name: "asc" },
  });
  const site = getPublicSiteUrl();
  const wallet = profile.walletAddress ?? "";
  const paidOrders = wallet
    ? await prisma.order.findMany({
        where: {
          wallet: { equals: wallet, mode: "insensitive" },
          status: "paid",
          agentId: { not: null },
        },
        select: {
          id: true,
          orderNumber: true,
          productType: true,
          paidAt: true,
        },
        orderBy: { paidAt: "desc" },
        take: 20,
      })
    : [];
  return {
    email: profile.email,
    wallet: profile.walletAddress,
    ownedAgents: ownedAgents.map((agent) => ({
      id: agent.id,
      agentId: agent.agentId,
      chainId: agent.chainId,
      name: agent.name,
      isVerified: agent.isVerified,
      isPremiumVerified: agent.isPremiumVerified,
      isVerifiedRevenue: agent.isVerifiedRevenue,
      slug: toAgentUrlSlug(agent.name),
      profilePath: agentPublicPath(agent),
      profileUrl: agentPublicUrl(site, agent),
      dashboardPath: `/dashboard/agents/${agent.id}`,
    })),
    paidOrders: paidOrders.map((order) => ({
      ...order,
      paidAt: order.paidAt?.toISOString() ?? null,
    })),
  };
}
