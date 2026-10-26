import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  linkedAgentsWhereForProfiles,
  profileIdsLinkedToAgent,
  type LinkedAgentRow,
  type ProfileLinkContext,
} from "@/lib/profile-linked-agents";
import {
  buildProfileListItem,
  type SocialProfileListItem,
  type UserProfileRow,
} from "@/lib/profile-summary";
import { reputationMeetsHighThreshold } from "@/lib/builder-reputation";
import { batchIsHolderGoldenProfile } from "@/lib/holder-golden-profile";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
import { prisma } from "@/lib/db";
import {
  findAgentFuzzyNameCandidates,
  orderRowsByFuzzyCandidates,
} from "@/lib/agent-fuzzy-search.server";
export type SocialProfileFilter =
  | "all"
  | "verified"
  | "creators"
  | "high_reputation"
  | "sap"
  | "x402"
  | "active";
const ACTIVE_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export function parseSocialFilter(raw: string | null): SocialProfileFilter {
  const v = (raw ?? "all").toLowerCase();
  if (
    v === "verified" ||
    v === "creators" ||
    v === "high_reputation" ||
    v === "sap" ||
    v === "x402" ||
    v === "active"
  ) {
    return v;
  }
  return "all";
}
async function walletsFromAgentNameSearch(term: string): Promise<string[]> {
  const exactAgents = await prisma.agent.findMany({
    where: {
      isActive: true,
      name: { contains: term, mode: "insensitive" },
      owner: { not: "" },
    },
    select: { owner: true },
    take: 40,
    distinct: ["owner"],
  });
  const wallets = new Set(
    exactAgents.map((agent) => agent.owner.trim().toLowerCase()).filter(Boolean),
  );
  if (wallets.size > 0) return [...wallets];

  const fuzzyCandidates = await findAgentFuzzyNameCandidates({
    query: term,
    limit: 64,
    activeOnly: true,
  });
  if (fuzzyCandidates.length === 0) return [...wallets];

  const fuzzyRows = await prisma.agent.findMany({
    where: {
      id: { in: fuzzyCandidates.map((candidate) => candidate.id) },
      isActive: true,
      owner: { not: "" },
    },
    select: { id: true, owner: true },
  });
  for (const agent of orderRowsByFuzzyCandidates(fuzzyRows, fuzzyCandidates)) {
    const owner = agent.owner.trim().toLowerCase();
    if (owner) wallets.add(owner);
    if (wallets.size >= 40) break;
  }
  return [...wallets];
}
export async function buildProfileSearchWhere(q: string): Promise<Prisma.UserProfileWhereInput> {
  const term = q.trim();
  if (term.length < 2) return {};
  const agentWallets = await walletsFromAgentNameSearch(term);
  const or: Prisma.UserProfileWhereInput[] = [
    { displayName: { contains: term, mode: "insensitive" } },
    { username: { contains: term, mode: "insensitive" } },
    { walletAddress: { contains: term, mode: "insensitive" } },
  ];
  if (agentWallets.length > 0) {
    or.push({ walletAddress: { in: agentWallets, mode: "insensitive" } });
  }
  return { OR: or };
}
function matchesFilter(
  item: SocialProfileListItem,
  filter: SocialProfileFilter,
  golden: boolean,
): boolean {
  const agg = item.aggregate;
  switch (filter) {
    case "all":
      return true;
    case "verified":
      return golden || item.profileVerified;
    case "creators":
      return agg.linkedAgentCount >= 1;
    case "high_reputation":
      return reputationMeetsHighThreshold(item.reputation);
    case "sap":
      return agg.hasSap;
    case "x402":
      return agg.hasX402;
    case "active": {
      if (!agg.lastActiveAt) return false;
      return Date.now() - new Date(agg.lastActiveAt).getTime() <= ACTIVE_DAYS_MS;
    }
    default:
      return true;
  }
}
export async function groupAgentsByProfileId(
  profiles: readonly ProfileLinkContext[],
): Promise<Map<number, LinkedAgentRow[]>> {
  const map = new Map<number, LinkedAgentRow[]>();
  for (const p of profiles) {
    map.set(p.id, []);
  }
  const where = linkedAgentsWhereForProfiles(profiles);
  if (!where) return map;
  const agents = (await prisma.agent.findMany({
    where: { ...where, isActive: true, agentId: { not: 88888 } },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      image: true,
      rank: true,
      score: true,
      agentRankScore: true,
      protocolTrustScore: true,
      totalFeedback: true,
      isActive: true,
      isVerified: true,
      isPremiumVerified: true,
      x402Support: true,
      sapVerified: true,
      lastActiveAt: true,
      scoreMetadata: true,
      scoreServices: true,
      owner: true,
      verifiedWallet: true,
      sapOwnerWallet: true,
      sapOperatorClaim: { select: { userProfileId: true } },
      services: { select: { name: true }, take: 8 },
      chain: { select: { shortName: true, color: true, icon: true } },
    },
    take: Math.min(800, Math.max(60, profiles.length * 30)),
  })) as LinkedAgentRow[];
  for (const agent of agents) {
    const ids = profileIdsLinkedToAgent(agent, profiles);
    for (const pid of ids) {
      const list = map.get(pid);
      if (list) list.push(agent);
    }
  }
  return map;
}
export async function buildSocialProfileItems(
  rows: UserProfileRow[],
): Promise<SocialProfileListItem[]> {
  const contexts: ProfileLinkContext[] = rows
    .filter((r) => r.walletAddress?.trim())
    .map((r) => ({
      id: r.id,
      walletAddress: r.walletAddress,
      solanaWallet: r.solanaWallet ?? null,
    }));
  const [agentMap, goldenByWallet] = await Promise.all([
    groupAgentsByProfileId(contexts),
    batchIsHolderGoldenProfile(rows.map((r) => r.walletAddress)),
  ]);
  return rows
    .filter((r) => r.walletAddress?.trim())
    .map((row) => {
      const walletKey = normalizeStakeWallet(row.walletAddress);
      return buildProfileListItem(row, agentMap.get(row.id) ?? [], {
        isHolderGolden: walletKey ? Boolean(goldenByWallet.get(walletKey)) : false,
      });
    });
}
export async function fetchSocialProfilesPage(args: {
  page: number;
  perPage: number;
  filter: SocialProfileFilter;
  q: string;
  featured?: boolean;
}): Promise<{
  profiles: SocialProfileListItem[];
  total: number;
  totalPages: number;
  hasMore: boolean;
  totalIsExact: boolean;
}> {
  const baseWhere: Prisma.UserProfileWhereInput = {
    walletAddress: { not: null },
    NOT: { walletAddress: "" },
  };
  const normalizedSearch = args.q.trim();
  const hasSearch = normalizedSearch.length >= 2;
  const searchWhere = hasSearch ? await buildProfileSearchWhere(normalizedSearch) : {};
  const where: Prisma.UserProfileWhereInput = { AND: [baseWhere, searchWhere] };
  if (args.featured) {
    const rows = (await prisma.userProfile.findMany({
      where,
      orderBy: [{ followersCount: "desc" }, { updatedAt: "desc" }],
      take: Math.min(48, args.perPage * 4),
      select: profileSelect,
    })) as UserProfileRow[];
    let items = await buildSocialProfileItems(rows);
    items = items
      .filter((i) => i.aggregate.linkedAgentCount >= 1)
      .filter((i) => matchesFilter(i, args.filter, Boolean(i.isHolderGolden)))
      .sort((a, b) => {
        const sa = a.reputation.status === "ok" ? (a.reputation.score ?? 0) : 0;
        const sb = b.reputation.status === "ok" ? (b.reputation.score ?? 0) : 0;
        if (sb !== sa) return sb - sa;
        return b.followersCount - a.followersCount;
      })
      .slice(0, args.perPage);
    return {
      profiles: items,
      total: items.length,
      totalPages: 1,
      hasMore: false,
      totalIsExact: true,
    };
  }
  if (args.filter === "all" && !hasSearch) {
    const total = await prisma.userProfile.count({ where });
    const rows = (await prisma.userProfile.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (args.page - 1) * args.perPage,
      take: args.perPage,
      select: profileSelect,
    })) as UserProfileRow[];
    const profiles = await buildSocialProfileItems(rows);
    return {
      profiles,
      total,
      totalPages: Math.max(1, Math.ceil(total / args.perPage)),
      hasMore: args.page * args.perPage < total,
      totalIsExact: true,
    };
  }
  const scanTake = 100;
  const pageStart = (args.page - 1) * args.perPage;
  const pageEnd = pageStart + args.perPage;
  const targetMatchCount = pageEnd + 1;
  let skip = 0;
  let sourceExhausted = false;
  const matched: SocialProfileListItem[] = [];
  while (matched.length < targetMatchCount && !sourceExhausted) {
    const rows = (await prisma.userProfile.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take: scanTake,
      select: profileSelect,
    })) as UserProfileRow[];
    if (rows.length === 0) {
      sourceExhausted = true;
      break;
    }
    skip += rows.length;
    const items = await buildSocialProfileItems(rows);
    for (const item of items) {
      if (matchesFilter(item, args.filter, Boolean(item.isHolderGolden))) {
        matched.push(item);
        if (matched.length >= targetMatchCount) break;
      }
    }
    sourceExhausted = rows.length < scanTake;
  }
  const hasMore = matched.length > pageEnd;
  const totalIsExact = sourceExhausted;
  const total = totalIsExact ? matched.length : Math.max(matched.length, targetMatchCount);
  const totalPages = totalIsExact
    ? Math.max(1, Math.ceil(total / args.perPage))
    : args.page + 1;
  return {
    profiles: matched.slice(pageStart, pageEnd),
    total,
    totalPages,
    hasMore,
    totalIsExact,
  };
}
const profileSelect = {
  id: true,
  walletAddress: true,
  username: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  followersCount: true,
  followingCount: true,
  createdAt: true,
  updatedAt: true,
  solanaWallet: true,
} as const;
export async function fetchSocialHubStats(): Promise<{
  totalProfiles: number;
  verifiedProfiles: number;
  claimedAgents: number;
  avgArScore: number | null;
}> {
  const profileWhere = { walletAddress: { not: null }, NOT: { walletAddress: "" } } as const;
  const [totalProfiles, claimedAgents, avgRow, verifiedProfiles] = await Promise.all([
    prisma.userProfile.count({ where: profileWhere }),
    prisma.sapAgentOperatorClaim.count(),
    prisma.agent.aggregate({
      where: { isActive: true, agentRankScore: { gt: 0 } },
      _avg: { agentRankScore: true },
    }),
    prisma.userProfile.count({
      where: {
        ...profileWhere,
        sapAgentClaims: { some: {} },
      },
    }),
  ]);
  return {
    totalProfiles,
    verifiedProfiles,
    claimedAgents,
    avgArScore: avgRow._avg.agentRankScore
      ? Math.round(avgRow._avg.agentRankScore)
      : null,
  };
}
