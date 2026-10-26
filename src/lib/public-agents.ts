import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AGENTRANKING_LISTING_SOURCE } from "@/lib/dashboard/native-agent";
import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
export type {
  PublicAgentPreview,
} from "@/lib/public-agent-display";
export type { PublicAgentLinkedToken } from "@/lib/public-agent-token";
export {
  pickPublicAgentLinkedTokenFromPreview,
  isPublicAgentTokenized,
} from "@/lib/public-agent-display";
export { pickPublicAgentLinkedToken } from "@/lib/public-agent-token";
const AGENT_SOCIAL_METADATA_KEYS = [
  "twitter",
  "telegram",
  "website",
  "twitterUrl",
  "telegramUrl",
  "websiteUrl",
] as const;
function launchedAgentPreviewSelect(network: string): Prisma.AgentSelect {
  return {
    id: true,
    agentId: true,
    chainId: true,
    name: true,
      image: true,
    description: true,
    score: true,
    agentRankScore: true,
    isVerified: true,
    isPremiumVerified: true,
    publicVerificationStatus: true,
    arVerificationStatus: true,
    solanaAssetAddress: true,
    solanaCanonicalStatus: true,
    ownerAccount: {
      select: {
        publicId: true,
        verificationLevel: true,
        verificationStatus: true,
        verificationExpiresAt: true,
        verifiedAt: true,
      },
    },
    lastActiveAt: true,
    listedAt: true,
    tokenAddress: true,
    metaplexAgentTokenMint: true,
    metadata: {
      where: { key: { in: [...AGENT_SOCIAL_METADATA_KEYS] } },
      select: { key: true, value: true },
    },
    agentLaunches: {
      where: {
        network,
        launchStatus: "indexed",
        feeSharingStatus: "active",
        mint: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: {
        id: true,
        mint: true,
        tokenSymbol: true,
        tokenName: true,
        launchKind: true,
        launchStatus: true,
        feeSharingStatus: true,
        createdAt: true,
        totalFeesDistributedLamports: true,
        profileWebsite: true,
        profileTwitter: true,
        profileTelegram: true,
      },
    },
  };
}
/** Load agents for the public agents page. Falls back to all active agents when no native AR agents exist. */
export async function loadPublicAgentsPreview(limit = 48) {
  const network = getAgentLaunchConfig().network;
  const select = launchedAgentPreviewSelect(network);
  const publicWhere = await extendAgentWhereIndexable();
  const native = await prisma.agent.findMany({
    where: {
      AND: [
        publicWhere,
        {
          listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
          chainId: AGENTRANKING_NATIVE_CHAIN_ID,
        },
      ],
    },
    orderBy: [{ listedAt: "desc" }, { id: "desc" }],
    take: limit,
    select,
  });
  if (native.length > 0) return native;
  // Fallback: no native AR agents yet — show all active agents from the general index
  return prisma.agent.findMany({
    where: publicWhere,
    orderBy: [{ listedAt: "desc" }, { id: "desc" }],
    take: limit,
    select,
  });
}
