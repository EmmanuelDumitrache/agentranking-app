import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AGENTRANKING_LISTING_SOURCE } from "@/lib/dashboard/native-agent";
import { getPublicSiteUrl } from "@/lib/site-url";
import { agentPublicUrl } from "@/lib/agent-public-url";
export type AdminCreatorListItem = {
  id: string;
  userProfileId: number;
  email: string | null;
  displayName: string | null;
  imageUrl: string | null;
  authProviders: string[];
  accountWalletPublicKey: string | null;
  platformCredits: number;
  llmCredits: number;
  maxAgents: number;
  agentCount: number;
  tokenizedCount: number;
  lastLoginAt: string | null;
  createdAt: string;
};
export type AdminCreatorAgentRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  description: string;
  image: string;
  isActive: boolean;
  publicVerificationStatus: string;
  listingRegistrySource: string;
  hasToken: boolean;
  tokenMint: string | null;
  tokenSymbol: string | null;
  publicHref: string;
  createdAt: string;
};
export type AdminCreatorLaunchRow = {
  id: string;
  agentDbId: number | null;
  agentName: string | null;
  mint: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImageUrl: string | null;
  network: string;
  launchStatus: string;
  launchKind: string;
  arTokenVerificationStatus: string;
  createdAt: string;
  publicTokenHref: string | null;
};
export type AdminCreatorDetail = AdminCreatorListItem & {
  adminNotes: string;
  onboardingCompletedAt: string | null;
  agents: AdminCreatorAgentRow[];
  launches: AdminCreatorLaunchRow[];
};
function resolveEmail(
  appEmail: string | null | undefined,
  profileEmail: string | null | undefined,
): string | null {
  const e = (appEmail?.trim() || profileEmail?.trim() || "").toLowerCase();
  return e || null;
}
export async function loadAuthProvidersByEmails(
  emails: readonly string[],
): Promise<Map<string, string[]>> {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (normalized.length === 0) return new Map();
  const users = await prisma.authUser.findMany({
    where: { email: { in: normalized } },
    select: {
      email: true,
      accounts: { select: { provider: true } },
    },
  });
  const map = new Map<string, string[]>();
  for (const user of users) {
    if (!user.email) continue;
    const providers = [...new Set(user.accounts.map((a) => a.provider))].sort();
    map.set(user.email.toLowerCase(), providers);
  }
  return map;
}
async function loadTokenizedCountsByAccountIds(
  accountIds: readonly string[],
): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const agents = await prisma.agent.findMany({
    where: { ownerAccountId: { in: [...accountIds] } },
    select: { id: true, ownerAccountId: true },
  });
  const agentIdToAccount = new Map<number, string>();
  for (const agent of agents) {
    if (agent.ownerAccountId) agentIdToAccount.set(agent.id, agent.ownerAccountId);
  }
  const agentDbIds = agents.map((a) => a.id);
  if (agentDbIds.length === 0) return new Map();
  const launches = await prisma.agentLaunch.findMany({
    where: { agentDbId: { in: agentDbIds }, mint: { not: null } },
    select: { agentDbId: true },
  });
  const counts = new Map<string, number>();
  for (const launch of launches) {
    if (launch.agentDbId == null) continue;
    const accountId = agentIdToAccount.get(launch.agentDbId);
    if (!accountId) continue;
    counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
  }
  return counts;
}
export async function listAdminCreators(input: {
  page: number;
  perPage: number;
  search: string;
  provider: string;
}): Promise<{
  creators: AdminCreatorListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}> {
  const { page, perPage, search, provider } = input;
  const and: Prisma.AppAccountWhereInput[] = [];
  if (search.trim()) {
    const q = search.trim();
    and.push({
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { userProfile: { email: { contains: q, mode: "insensitive" } } },
        { userProfile: { displayName: { contains: q, mode: "insensitive" } } },
        { accountWallet: { publicKey: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (provider && provider !== "all") {
    const emailsWithProvider = (
      await prisma.authUser.findMany({
        where: { accounts: { some: { provider } } },
        select: { email: true },
      })
    )
      .map((u) => u.email?.toLowerCase())
      .filter((e): e is string => Boolean(e));
    if (emailsWithProvider.length === 0) {
      return { creators: [], total: 0, page, perPage, totalPages: 1 };
    }
    and.push({
      userProfile: { is: { email: { in: emailsWithProvider } } },
    });
  }
  const where: Prisma.AppAccountWhereInput = and.length > 0 ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.appAccount.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        userProfile: {
          select: {
            id: true,
            email: true,
            displayName: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        accountWallet: { select: { publicKey: true } },
        _count: { select: { agents: true } },
      },
    }),
    prisma.appAccount.count({ where }),
  ]);
  const emails = rows.map((row) =>
    resolveEmail(row.email, row.userProfile.email),
  ).filter((e): e is string => Boolean(e));
  const [providersByEmail, tokenizedCounts] = await Promise.all([
    loadAuthProvidersByEmails(emails),
    loadTokenizedCountsByAccountIds(rows.map((r) => r.id)),
  ]);
  const creators: AdminCreatorListItem[] = rows.map((row) => {
    const email = resolveEmail(row.email, row.userProfile.email);
    return {
      id: row.id,
      userProfileId: row.userProfileId,
      email,
      displayName: row.displayName ?? row.userProfile.displayName,
      imageUrl: row.imageUrl,
      authProviders: email ? providersByEmail.get(email) ?? [] : [],
      accountWalletPublicKey: row.accountWallet?.publicKey ?? null,
      platformCredits: row.platformCredits,
      llmCredits: row.llmBalanceCents,
      maxAgents: row.maxAgents,
      agentCount: row._count.agents,
      tokenizedCount: tokenizedCounts.get(row.id) ?? 0,
      lastLoginAt: row.userProfile.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
  return {
    creators,
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}
export async function loadAdminCreatorDetail(accountId: string): Promise<AdminCreatorDetail | null> {
  const row = await prisma.appAccount.findUnique({
    where: { id: accountId },
    include: {
      userProfile: {
        select: {
          id: true,
          email: true,
          displayName: true,
          lastLoginAt: true,
          createdAt: true,
          adminNotes: true,
        },
      },
      accountWallet: { select: { publicKey: true } },
      agents: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          agentId: true,
          chainId: true,
          name: true,
          description: true,
          image: true,
          isActive: true,
          publicVerificationStatus: true,
          listingRegistrySource: true,
          createdAt: true,
          agentLaunches: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { mint: true, tokenSymbol: true },
          },
        },
      },
      _count: { select: { agents: true } },
    },
  });
  if (!row) return null;
  const email = resolveEmail(row.email, row.userProfile.email);
  const agentDbIds = row.agents.map((agent) => agent.id);
  const [providersByEmail, launches] = await Promise.all([
    email
      ? loadAuthProvidersByEmails([email])
      : Promise.resolve(new Map<string, string[]>()),
    agentDbIds.length
      ? prisma.agentLaunch.findMany({
          where: { agentDbId: { in: agentDbIds } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            agentDbId: true,
            mint: true,
            tokenName: true,
            tokenSymbol: true,
            tokenImageUrl: true,
            network: true,
            launchStatus: true,
            launchKind: true,
            arTokenVerificationStatus: true,
            createdAt: true,
            linkedAgent: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const site = getPublicSiteUrl();
  const agents: AdminCreatorAgentRow[] = row.agents.map((agent) => {
    const launch = agent.agentLaunches[0];
    return {
      id: agent.id,
      agentId: agent.agentId,
      chainId: agent.chainId,
      name: agent.name,
      description: agent.description,
      image: agent.image,
      isActive: agent.isActive,
      publicVerificationStatus: agent.publicVerificationStatus,
      listingRegistrySource: agent.listingRegistrySource,
      hasToken: Boolean(launch?.mint),
      tokenMint: launch?.mint ?? null,
      tokenSymbol: launch?.tokenSymbol ?? null,
      publicHref: agentPublicUrl(site, agent),
      createdAt: agent.createdAt.toISOString(),
    };
  });
  const launchRows: AdminCreatorLaunchRow[] = launches.map((launch) => ({
    id: launch.id,
    agentDbId: launch.agentDbId,
    agentName: launch.linkedAgent?.name ?? null,
    mint: launch.mint,
    tokenName: launch.tokenName,
    tokenSymbol: launch.tokenSymbol,
    tokenImageUrl: launch.tokenImageUrl,
    network: launch.network,
    launchStatus: launch.launchStatus,
    launchKind: launch.launchKind,
    arTokenVerificationStatus: launch.arTokenVerificationStatus,
    createdAt: launch.createdAt.toISOString(),
    publicTokenHref: launch.mint ? `${site}/tokens/${launch.mint}` : null,
  }));
  const tokenizedCount = launchRows.filter((l) => l.mint).length;
  return {
    id: row.id,
    userProfileId: row.userProfileId,
    email,
    displayName: row.displayName ?? row.userProfile.displayName,
    imageUrl: row.imageUrl,
    authProviders: email ? providersByEmail.get(email) ?? [] : [],
    accountWalletPublicKey: row.accountWallet?.publicKey ?? null,
    platformCredits: row.platformCredits,
    llmCredits: row.llmBalanceCents,
    maxAgents: row.maxAgents,
    agentCount: row._count.agents,
    tokenizedCount,
    lastLoginAt: row.userProfile.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    adminNotes: row.userProfile.adminNotes,
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    agents,
    launches: launchRows,
  };
}
export async function loadAdminCreatorMetrics(now: Date): Promise<{
  totalAppAccounts: number;
  newAppAccounts7d: number;
  nativeAgents: number;
  tokenizedLaunches: number;
  googleSignIns: number;
}> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [totalAppAccounts, newAppAccounts7d, nativeAgents, tokenizedLaunches, googleSignIns] =
    await Promise.all([
      prisma.appAccount.count(),
      prisma.appAccount.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.agent.count({
        where: { listingRegistrySource: AGENTRANKING_LISTING_SOURCE },
      }),
      prisma.agentLaunch.count({ where: { mint: { not: null } } }),
      prisma.authAccount.count({ where: { provider: "google" } }),
    ]);
  return {
    totalAppAccounts,
    newAppAccounts7d,
    nativeAgents,
    tokenizedLaunches,
    googleSignIns,
  };
}