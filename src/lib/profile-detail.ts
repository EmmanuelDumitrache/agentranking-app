import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveAuthorizedFollower } from "@/lib/profile-follow-auth";
import { extendAgentWhereNotBlocked } from "@/lib/agent-blocklist";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { feedbackSourceFromIndex, normalizeStoredFeedbackValue } from "@/lib/feedback-normalization";
import { isHolderGoldenProfile } from "@/lib/holder-golden-profile";
import { toJsonCompatible } from "@/lib/json-compatible";
import {
  aggregateLinkedAgents,
  buildProfileListItem,
  buildProtocolTags,
  toLinkedAgentPublic,
  type UserProfileRow,
} from "@/lib/profile-summary";
import {
  linkedAgentsWhereForProfile,
  type LinkedAgentRow,
} from "@/lib/profile-linked-agents";

const profileSelect = {
  id: true,
  walletAddress: true,
  username: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  twitterUrl: true,
  githubUrl: true,
  websiteUrl: true,
  followersCount: true,
  followingCount: true,
  createdAt: true,
  updatedAt: true,
  solanaWallet: true,
} as const;

export function normalizePublicProfileAddress(raw: string): string {
  const trimmed = raw.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

async function loadProfileDetailSource(normalizedWallet: string) {
  const isEvmWallet = /^0x[0-9a-fA-F]{40}$/.test(normalizedWallet);
  const profile = await prisma.userProfile.findFirst({
    where: isEvmWallet
      ? { walletAddress: { equals: normalizedWallet.toLowerCase(), mode: "insensitive" } }
      : { OR: [{ walletAddress: normalizedWallet }, { solanaWallet: normalizedWallet }] },
    select: profileSelect,
  });
  const linkContext = profile
    ? { id: profile.id, walletAddress: profile.walletAddress, solanaWallet: profile.solanaWallet }
    : { id: 0, walletAddress: normalizedWallet, solanaWallet: null as string | null };
  const [linkedAgentWhere, feedbackAgentWhere] = await Promise.all([
    extendAgentWhereNotBlocked({
      ...linkedAgentsWhereForProfile(linkContext),
      isActive: true,
      agentId: { not: 88888 },
    }),
    extendAgentWhereNotBlocked({}),
  ]);
  const [linkedAgents, feedbackGiven, isHolderGolden] = await Promise.all([
    prisma.agent.findMany({
      where: linkedAgentWhere,
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
      orderBy: [{ rank: "asc" }, { agentRankScore: "desc" }],
      take: 50,
    }) as Promise<LinkedAgentRow[]>,
    prisma.feedback.findMany({
      where: {
        clientAddress: isEvmWallet
          ? { equals: normalizedWallet.toLowerCase(), mode: "insensitive" }
          : normalizedWallet,
        revoked: false,
        agent: feedbackAgentWhere,
      },
      include: {
        agent: {
          select: {
            id: true,
            agentId: true,
            chainId: true,
            name: true,
            chain: { select: { shortName: true, color: true, icon: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    isHolderGoldenProfile(normalizedWallet),
  ]);
  const linkedPublic = linkedAgents.map(toLinkedAgentPublic);
  const profileRow: UserProfileRow | null = profile
    ? { ...profile, walletAddress: profile.walletAddress ?? normalizedWallet }
    : null;
  const summaryItem = profileRow
    ? buildProfileListItem(profileRow, linkedAgents, { isHolderGolden })
    : null;
  const aggregate = summaryItem?.aggregate ?? aggregateLinkedAgents(linkedAgents);
  const reputation = summaryItem?.reputation ?? {
    status: "insufficient" as const,
    label: "Insufficient data",
    score: null,
  };
  const avgFeedbackGiven =
    feedbackGiven.length > 0
      ? Math.round(
          (feedbackGiven.reduce((sum, feedback) => {
            const normalized = normalizeStoredFeedbackValue(
              feedback.value,
              feedback.valueDecimals,
              feedbackSourceFromIndex(feedback.feedbackIndex, feedback.sourceRegistry),
            );
            return sum + normalized.displayScore;
          }, 0) /
            feedbackGiven.length) *
            10,
        ) / 10
      : null;
  return {
    profile,
    feedbackGiven,
    linkedPublic,
    isHolderGolden,
    aggregate,
    reputation,
    avgFeedbackGiven,
  };
}

type ProfileDetailSource = Awaited<ReturnType<typeof loadProfileDetailSource>>;

function buildCommonProfilePayload(source: ProfileDetailSource, normalizedWallet: string) {
  const protocolTags = buildProtocolTags(source.aggregate);
  return {
    walletAddress: normalizedWallet,
    isHolderGolden: source.isHolderGolden,
    linkedAgents: source.linkedPublic,
    ownedAgents: source.linkedPublic,
    builderReputation: source.reputation,
    protocolTags,
    profileVerified: Boolean(source.isHolderGolden) || source.aggregate.hasVerifiedAgent,
    summary: {
      linkedAgentCount: source.aggregate.linkedAgentCount,
      avgArScore: source.aggregate.avgArScore,
      highestArScore: source.aggregate.highestArScore,
      topAgentName: source.aggregate.topAgentName,
      topAgentRank: source.aggregate.topAgentRank,
      totalReviews: source.aggregate.totalReviews,
      protocolTags,
    },
    stats: {
      agentsCount: source.aggregate.linkedAgentCount,
      feedbackCount: source.feedbackGiven.length,
      avgFeedbackGiven: source.avgFeedbackGiven,
    },
  };
}

/** Narrow, deliberately serialisable DTO for Server Component hydration. */
export async function fetchProfileDetail(normalizedWallet: string) {
  const source = await loadProfileDetailSource(normalizedWallet);
  return {
    profile: source.profile
      ? {
          id: source.profile.id,
          walletAddress: source.profile.walletAddress,
          solanaWallet: source.profile.solanaWallet,
          username: source.profile.username,
          displayName: source.profile.displayName,
          bio: source.profile.bio,
          avatarUrl: source.profile.avatarUrl,
          twitterUrl: source.profile.twitterUrl,
          githubUrl: source.profile.githubUrl,
          websiteUrl: source.profile.websiteUrl,
          followersCount: source.profile.followersCount,
          followingCount: source.profile.followingCount,
          createdAt: source.profile.createdAt.toISOString(),
          updatedAt: source.profile.updatedAt.toISOString(),
        }
      : null,
    ...buildCommonProfilePayload(source, normalizedWallet),
    feedbackGiven: source.feedbackGiven.map((feedback) => {
      const normalized = normalizeStoredFeedbackValue(
        feedback.value,
        feedback.valueDecimals,
        feedbackSourceFromIndex(feedback.feedbackIndex, feedback.sourceRegistry),
      );
      return {
        id: feedback.id,
        value: feedback.value,
        displayScore: normalized.displayScore,
        source: normalized.source,
        tag1: feedback.tag1 || null,
        tag2: feedback.tag2 || null,
        comment: feedback.comment,
        createdAt: feedback.createdAt.toISOString(),
        agent: {
          ...feedback.agent,
          slug: toAgentUrlSlug(feedback.agent.name),
          profilePath: agentPublicPath(feedback.agent),
        },
      };
    }),
    generatedAt: new Date().toISOString(),
  };
}

/** Keeps the pre-migration Route Handler response structure for browser/API callers. */
export async function fetchProfileDetailApi(normalizedWallet: string) {
  const source = await loadProfileDetailSource(normalizedWallet);
  return toJsonCompatible({
    profile: source.profile ?? null,
    ...buildCommonProfilePayload(source, normalizedWallet),
    feedbackGiven: source.feedbackGiven.map((feedback) => {
      const normalized = normalizeStoredFeedbackValue(
        feedback.value,
        feedback.valueDecimals,
        feedbackSourceFromIndex(feedback.feedbackIndex, feedback.sourceRegistry),
      );
      return {
        ...feedback,
        displayScore: normalized.displayScore,
        source: normalized.source,
        agent: {
          ...feedback.agent,
          slug: toAgentUrlSlug(feedback.agent.name),
          profilePath: agentPublicPath(feedback.agent),
        },
      };
    }),
  });
}
export async function fetchProfilePageSnapshot(rawAddress: string) {
  const address = normalizePublicProfileAddress(rawAddress);
  const [data, session] = await Promise.all([
    fetchProfileDetail(address),
    getServerSession(authOptions),
  ]);
  const auth = await resolveAuthorizedFollower(session);
  if (!auth.ok) {
    return { data, viewer: { followerAddress: null, isFollowing: false } };
  }
  const record = await prisma.profileFollow.findUnique({
    where: {
      followerAddress_followingAddress: {
        followerAddress: auth.followerAddress,
        followingAddress: address.toLowerCase(),
      },
    },
    select: { id: true },
  });
  return {
    data,
    viewer: { followerAddress: auth.followerAddress, isFollowing: Boolean(record) },
  };
}
