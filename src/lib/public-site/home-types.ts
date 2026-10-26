import type { TokenDiscoveryCardModel } from "@/lib/agent-launch/launch-index-data.server";
import type { PublicAgentPreview } from "@/lib/public-site/types";

export type LandingRankedAgent = {
  readonly rank: string;
  readonly href: string;
  readonly initials: string;
  readonly name: string;
  readonly verified: boolean;
  readonly chains: string;
  readonly category: string;
  readonly score: string;
  readonly imageUrl: string;
};

export type SphereImageData = {
  id: string;
  src: string;
  alt: string;
};

export type PublicSiteHomeStats = {
  totalAgents: number;
  totalChains: number;
  verifiedAgents: number;
  sapVerifiedAgents: number;
  mcpAgents: number;
  generatedAt: string;
  isLive: boolean;
};

export type PublicSiteHomeData = {
  stats: PublicSiteHomeStats;
  tokenLaunchCount: number;
  nativeAgentCount: number;
  tokens: readonly TokenDiscoveryCardModel[];
  agents: readonly PublicAgentPreview[];
  rankedAgents: readonly LandingRankedAgent[];
  sphereAgents: readonly SphereImageData[];
};
