import type { DirectoryEcosystemStats } from "@/lib/agent-directory/types";
export interface MiniAgent {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  score: number;
  rank?: number;
  organicRank?: number;
  x402Support?: boolean;
  description?: string;
  image?: string;
  isVerified?: boolean;
  isPremiumVerified?: boolean;
  sapVerified?: boolean;
  sapTwinMatch?: boolean;
  hasDuplicateName?: boolean;
  hotScore?: number;
  powerScore?: number;
  activeBoosts?: number;
  adminPowerAdjust?: number;
  hasHolderPowerBoost?: boolean;
  createdAt?: string | Date;
  listedAt?: string | null;
  lastActiveAt?: string;
  totalFeedback?: number;
  chain: { shortName: string; color: string; icon: string };
  deploymentCount?: number;
  chainLogoStack?: Array<{
    chainId: number;
    icon: string;
    chainShortName: string;
    chainName: string;
  }>;
  slug?: string;
  profilePath: string;
  services?: Array<{ name: string }>;
  agentRankScore?: number;
  discoveryScore?: number;
  reputationScore?: number;
  protocolTrustScore?: number;
  executionScore?: number;
  archetype?: string | null;
  archetypeAuto?: string | null;
  listingRegistrySource?: string | null;
  metaplexVerified?: boolean;
  metaplexAssetAddress?: string | null;
  metaplexAgentTokenMint?: string | null;
  isClaimed?: boolean;
  clusterChainVerified?: boolean;
  clusterIdentityRegistered?: boolean;
}
interface StatsData {
  totalAgents: number;
  totalFeedback: number;
  activeAgents: number;
  totalChains: number;
  verifiedAgents?: number;
  sapVerifiedAgents?: number;
  feedbackToday?: number;
  latestAgents: MiniAgent[];
  topRanked: MiniAgent[];
  featured: MiniAgent[];
  trending: MiniAgent[];
}
interface TopByChainData {
  topByChain: Record<number, MiniAgent[]>;
}
export type HomeData = StatsData & TopByChainData;
export type HomeRecommendedAgentsPayload = {
  agents: MiniAgent[];
  total: number;
  totalPages: number;
};
export interface HomePageClientProps {
  initialData?: HomeData;
  initialEcosystemStats?: DirectoryEcosystemStats;
  initialRecommendedAgents?: HomeRecommendedAgentsPayload;
}
