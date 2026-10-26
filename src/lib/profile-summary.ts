import {
  computeBuilderReputation,
  countReputationSignals,
  protocolDiversityScore,
  type BuilderReputationResult,
} from "@/lib/builder-reputation";
import {
  linkedAgentRankScore,
  agentHasMcp,
  agentIsComplete,
  type LinkedAgentRow,
} from "@/lib/profile-linked-agents";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
export type ProfileAgentAggregate = {
  linkedAgentCount: number;
  avgArScore: number;
  totalReviews: number;
  verifiedAgentCount: number;
  activeCompleteCount: number;
  topAgentName: string | null;
  topAgentRank: number | null;
  highestArScore: number;
  hasSap: boolean;
  hasX402: boolean;
  hasMcp: boolean;
  hasVerifiedAgent: boolean;
  hasErc8004: boolean;
  lastActiveAt: string | null;
};
export function aggregateLinkedAgents(agents: readonly LinkedAgentRow[]): ProfileAgentAggregate {
  if (agents.length === 0) {
    return {
      linkedAgentCount: 0,
      avgArScore: 0,
      totalReviews: 0,
      verifiedAgentCount: 0,
      activeCompleteCount: 0,
      topAgentName: null,
      topAgentRank: null,
      highestArScore: 0,
      hasSap: false,
      hasX402: false,
      hasMcp: false,
      hasVerifiedAgent: false,
      hasErc8004: true,
      lastActiveAt: null,
    };
  }
  let arSum = 0;
  let totalReviews = 0;
  let verifiedAgentCount = 0;
  let activeCompleteCount = 0;
  let hasSap = false;
  let hasX402 = false;
  let hasMcp = false;
  let hasVerifiedAgent = false;
  let highestArScore = 0;
  let topAgent: LinkedAgentRow | null = null;
  let lastActiveAt: Date | null = null;
  for (const a of agents) {
    const ar = linkedAgentRankScore(a);
    arSum += ar;
    totalReviews += a.totalFeedback ?? 0;
    if (a.isVerified || a.isPremiumVerified) {
      verifiedAgentCount += 1;
      hasVerifiedAgent = true;
    }
    if (agentIsComplete(a)) activeCompleteCount += 1;
    if (a.sapVerified) hasSap = true;
    if (a.x402Support) hasX402 = true;
    if (agentHasMcp(a)) hasMcp = true;
    if (ar > highestArScore) highestArScore = ar;
    if (!topAgent || (a.rank > 0 && (topAgent.rank <= 0 || a.rank < topAgent.rank))) {
      topAgent = a;
    } else if (topAgent.rank <= 0 && ar > linkedAgentRankScore(topAgent)) {
      topAgent = a;
    }
    if (a.lastActiveAt) {
      if (!lastActiveAt || a.lastActiveAt > lastActiveAt) lastActiveAt = a.lastActiveAt;
    }
  }
  return {
    linkedAgentCount: agents.length,
    avgArScore: Math.round(arSum / agents.length),
    totalReviews,
    verifiedAgentCount,
    activeCompleteCount,
    topAgentName: topAgent?.name ?? null,
    topAgentRank: topAgent && topAgent.rank > 0 ? topAgent.rank : null,
    highestArScore,
    hasSap,
    hasX402,
    hasMcp,
    hasVerifiedAgent,
    hasErc8004: true,
    lastActiveAt: lastActiveAt?.toISOString() ?? null,
  };
}
export type SocialProfileListItem = {
  id: number;
  walletAddress: string;
  username: string | null;
  displayName: string | null;
  bio: string;
  avatarUrl: string;
  followersCount: number;
  followingCount: number;
  createdAt: string;
  updatedAt: string;
  isHolderGolden?: boolean;
  aggregate: ProfileAgentAggregate;
  reputation: BuilderReputationResult;
  profileVerified: boolean;
  protocolTags: string[];
};
export type UserProfileRow = {
  id: number;
  walletAddress: string | null;
  username: string | null;
  displayName: string | null;
  bio: string;
  avatarUrl: string;
  followersCount: number;
  followingCount: number;
  createdAt: Date;
  updatedAt: Date;
  solanaWallet?: string | null;
};
export function buildProtocolTags(agg: ProfileAgentAggregate): string[] {
  const tags: string[] = [];
  if (agg.hasSap) tags.push("SAP");
  if (agg.hasX402) tags.push("x402");
  if (agg.hasMcp) tags.push("MCP");
  if (agg.hasErc8004) tags.push("ERC-8004");
  return tags;
}
export function buildProfileListItem(
  profile: UserProfileRow,
  agents: readonly LinkedAgentRow[],
  options?: { isHolderGolden?: boolean },
): SocialProfileListItem {
  const aggregate = aggregateLinkedAgents(agents);
  const diversity = protocolDiversityScore({
    hasSap: aggregate.hasSap,
    hasX402: aggregate.hasX402,
    hasMcp: aggregate.hasMcp,
    hasErc8004: aggregate.hasErc8004,
  });
  const reputation = computeBuilderReputation({
    linkedAgentCount: aggregate.linkedAgentCount,
    avgArScore: aggregate.avgArScore,
    verifiedAgentCount: aggregate.verifiedAgentCount,
    activeCompleteCount: aggregate.activeCompleteCount,
    totalReviews: aggregate.totalReviews,
    protocolDiversity: diversity,
    signalCount: countReputationSignals({
      linkedAgentCount: aggregate.linkedAgentCount,
      avgArScore: aggregate.avgArScore,
      verifiedAgentCount: aggregate.verifiedAgentCount,
      activeCompleteCount: aggregate.activeCompleteCount,
      totalReviews: aggregate.totalReviews,
      protocolDiversity: diversity,
      signalCount: 0,
    }),
  });
  return {
    id: profile.id,
    walletAddress: (() => {
      const wallet = (profile.walletAddress ?? profile.solanaWallet ?? "").trim();
      return /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : wallet;
    })(),
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    followersCount: profile.followersCount,
    followingCount: profile.followingCount,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
    isHolderGolden: options?.isHolderGolden,
    aggregate,
    reputation,
    profileVerified: Boolean(options?.isHolderGolden) || aggregate.hasVerifiedAgent,
    protocolTags: buildProtocolTags(aggregate),
  };
}
export type LinkedAgentPublic = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string | null;
  slug: string;
  profilePath: string;
  rank: number;
  score: number;
  agentRankScore: number;
  protocolTrustScore: number;
  totalFeedback: number;
  isActive: boolean;
  isVerified: boolean;
  isPremiumVerified: boolean;
  x402Support: boolean;
  sapVerified: boolean;
  chain: { shortName: string; color: string; icon: string };
  services: Array<{ name: string }>;
};
export function toLinkedAgentPublic(agent: LinkedAgentRow): LinkedAgentPublic {
  return {
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    image: agent.image,
    slug: toAgentUrlSlug(agent.name),
    profilePath: agentPublicPath(agent),
    rank: agent.rank,
    score: agent.score,
    agentRankScore: linkedAgentRankScore(agent),
    protocolTrustScore: Math.round(agent.protocolTrustScore ?? 0),
    totalFeedback: agent.totalFeedback,
    isActive: agent.isActive,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    x402Support: agent.x402Support,
    sapVerified: agent.sapVerified,
    chain: agent.chain,
    services: agent.services,
  };
}
