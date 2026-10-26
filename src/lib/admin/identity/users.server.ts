import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import { buildOwnedAgentsWhere } from "@/lib/dashboard/agent-ownership";
import { getPublicSiteUrl } from "@/lib/site-url";
import { agentPublicPath, agentPublicUrl, toAgentUrlSlug } from "@/lib/agent-public-url";
import { requireAdminIdentity } from "./auth.server";
import type { AdminUsersQuery } from "./query";
import type {
  AdminDashboardAgentRow,
  AdminEmailAgentsResponse,
  AdminUserAgentsResponse,
  AdminUsersResponse,
} from "./types";

const AGENT_LIST_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  owner: true,
  verifiedWallet: true,
  isVerified: true,
  isPremiumVerified: true,
  isVerifiedRevenue: true,
} as const;

function decodeLookupParam(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return "";
  }
}

function normalizeWalletParam(raw: string): string {
  const wallet = decodeLookupParam(raw);
  if (!wallet) return "";
  return /^0x[a-f0-9]{40}$/i.test(wallet) ? wallet.toLowerCase() : wallet;
}

function walletFilter(wallet: string) {
  return { equals: wallet, mode: "insensitive" as const };
}

type AgentRecord = Prisma.AgentGetPayload<{ select: typeof AGENT_LIST_SELECT }>;

function formatAgent(base: string, agent: AgentRecord): AdminDashboardAgentRow {
  return {
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    owner: agent.owner,
    verifiedWallet: agent.verifiedWallet,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    isVerifiedRevenue: agent.isVerifiedRevenue,
    slug: toAgentUrlSlug(agent.name),
    profilePath: agentPublicPath(agent),
    profileUrl: agentPublicUrl(base, agent),
    dashboardPath: `/dashboard/agents/${agent.id}`,
  };
}

export async function readAdminUsers(query: AdminUsersQuery): Promise<AdminUsersResponse> {
  await requireAdminIdentity();
  const where = query.search
    ? {
        OR: [
          { walletAddress: { contains: query.search, mode: "insensitive" as const } },
          { username: { contains: query.search, mode: "insensitive" as const } },
          { displayName: { contains: query.search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [profiles, total] = await Promise.all([
    prisma.userProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      select: {
        id: true,
        walletAddress: true,
        username: true,
        displayName: true,
        bio: true,
        followersCount: true,
        followingCount: true,
        createdAt: true,
      },
    }),
    prisma.userProfile.count({ where }),
  ]);
  const rows = await mapWithConcurrency(profiles, 8, async (profile) => {
    if (!profile.walletAddress) {
      return {
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        agentsCount: 0,
        feedbackCount: 0,
      };
    }
    const wallet = profile.walletAddress;
    const [agentsCount, feedbackCount] = await Promise.all([
      prisma.agent.count({ where: { owner: walletFilter(wallet) } }),
      prisma.feedback.count({ where: { clientAddress: walletFilter(wallet) } }),
    ]);
    return {
      ...profile,
      createdAt: profile.createdAt.toISOString(),
      agentsCount,
      feedbackCount,
    };
  });
  return {
    profiles: rows,
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
  };
}

export async function readAdminUserAgentsByWallet(rawWallet: string): Promise<AdminUserAgentsResponse | null> {
  await requireAdminIdentity();
  const wallet = normalizeWalletParam(rawWallet);
  if (!wallet) return null;
  const profile = await prisma.userProfile.findFirst({
    where: { walletAddress: walletFilter(wallet) },
    select: { id: true, walletAddress: true },
  });
  if (!profile?.walletAddress) return null;
  const canonicalWallet = profile.walletAddress;
  const [ownedAgents, paidOrders, promotions, boosts, unlinkedPaidOrders] = await Promise.all([
    prisma.agent.findMany({
      where: {
        OR: [
          { owner: walletFilter(canonicalWallet) },
          {
            AND: [
              { verifiedWallet: { not: "" } },
              { verifiedWallet: walletFilter(canonicalWallet) },
            ],
          },
        ],
      },
      select: AGENT_LIST_SELECT,
      orderBy: { name: "asc" },
    }),
    prisma.order.findMany({
      where: {
        wallet: walletFilter(canonicalWallet),
        status: "paid",
        agentId: { not: null },
      },
      select: {
        productType: true,
        agent: { select: AGENT_LIST_SELECT },
      },
    }),
    prisma.promotion.findMany({
      where: {
        wallet: walletFilter(canonicalWallet),
        slotType: { in: ["premium_verify", "custom_listing", "hot", "featured"] },
      },
      select: {
        slotType: true,
        agent: { select: AGENT_LIST_SELECT },
      },
    }),
    prisma.agentBoost.findMany({
      where: { wallet: walletFilter(canonicalWallet) },
      select: { agent: { select: AGENT_LIST_SELECT } },
    }),
    prisma.order.findMany({
      where: {
        wallet: walletFilter(canonicalWallet),
        status: "paid",
        agentId: null,
      },
      select: { id: true, orderNumber: true, productType: true, paidAt: true },
      orderBy: { paidAt: "desc" },
      take: 50,
    }),
  ]);
  const paidMap = new Map<number, { agent: AgentRecord; sources: Set<string> }>();
  const addPaidAgent = (agent: AgentRecord | null, source: string) => {
    if (!agent) return;
    const current = paidMap.get(agent.id);
    if (current) current.sources.add(source);
    else paidMap.set(agent.id, { agent, sources: new Set([source]) });
  };
  for (const order of paidOrders) addPaidAgent(order.agent, `order:${order.productType}`);
  for (const promotion of promotions) addPaidAgent(promotion.agent, `promotion:${promotion.slotType}`);
  for (const boost of boosts) addPaidAgent(boost.agent, "boost");
  const base = getPublicSiteUrl();
  const ownedIds = new Set(ownedAgents.map((agent) => agent.id));
  const owned = ownedAgents.map((agent) => formatAgent(base, agent));
  return {
    wallet: canonicalWallet,
    ownedAgents: owned,
    dashboardAgents: owned,
    paidOrLinked: [...paidMap.values()].map(({ agent, sources }) => ({
      ...formatAgent(base, agent),
      sources: [...sources],
      isOwned: ownedIds.has(agent.id),
    })),
    unlinkedPaidOrders: unlinkedPaidOrders.map((order) => ({
      ...order,
      paidAt: order.paidAt?.toISOString() ?? null,
    })),
  };
}

export async function readAdminUserAgentsByEmail(rawEmail: string): Promise<AdminEmailAgentsResponse | null> {
  await requireAdminIdentity();
  const email = decodeLookupParam(rawEmail).toLowerCase();
  if (!email) return null;
  const profile = await prisma.userProfile.findUnique({
    where: { email },
    select: { id: true, email: true, walletAddress: true, solanaWallet: true },
  });
  if (!profile) return null;
  const ownedAgents = await prisma.agent.findMany({
    where: buildOwnedAgentsWhere(profile),
    select: AGENT_LIST_SELECT,
    orderBy: { name: "asc" },
  });
  const base = getPublicSiteUrl();
  const dashboardAgents = ownedAgents.map((agent) => formatAgent(base, agent));
  return {
    email: profile.email,
    wallet: profile.walletAddress,
    dashboardAgents,
    ownedAgents: dashboardAgents,
  };
}
