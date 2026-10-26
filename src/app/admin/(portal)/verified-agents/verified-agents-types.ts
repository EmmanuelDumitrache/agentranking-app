import type { AdminScoringLayerKey } from "@/lib/admin-scoring-layer-overrides";

export type AdminVerifiedAgentsFilter = "all" | "verified" | "unverified";

export interface AdminVerifiedAgentListItem {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  description: string;
  image: string;
  owner: string;
  tokenAddress: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  isActive: boolean;
  isCustomListed: boolean;
  createdAt: string;
  chain: { shortName: string; name: string };
  profilePath: string;
}

export interface AdminVerifiedAgentDetail extends AdminVerifiedAgentListItem {
  agentURI: string;
  metadata: { id: number; key: string; value: string }[];
  chain: { chainId: number; name: string; shortName: string };
  services: { id: number; name: string; endpoint: string; version: string }[];
  score: number;
  hotScore: number;
  rank: number;
  protocolTrustScore: number;
  agentRankScore?: number;
  executionScore: number;
  listingRegistrySource?: string;
  sapVerified?: boolean;
  sapStats?: unknown;
  adminPowerAdjust: number;
  scoreMetadata: number;
  scoreServices: number;
  scoreQuality: number;
  scorePopularity: number;
  scoreFreshness: number;
  scoreWallet: number;
  powerScore?: number;
  activeBoosts?: number;
  voteFireCount?: number;
  votePooCount?: number;
  publicReferralCode?: string | null;
  publicReferralDestination?: string;
  publicReferralInfo?: string;
  workReadyStatus?: string;
  featuredWorkReady?: boolean;
  workReadyReasons?: string[];
}

export interface AdminScoringLayerBreakdownRow {
  key: AdminScoringLayerKey;
  label: string;
  weightLabel: string;
  actual: number;
  display: number;
  overridden: boolean;
}

export interface AdminVerifiedAgentDetailExtras {
  computedAgentRankScore: number;
  scoringLayerBreakdown: {
    rows: AdminScoringLayerBreakdownRow[];
    formulaAgentRankScore: number;
  };
  socialPresence: {
    score: number;
    twitter: boolean;
    website: boolean;
    github: boolean;
    discord: boolean;
    telegram: boolean;
  };
}

export type AdminVerifiedAgentDetailPayload = {
  agent: AdminVerifiedAgentDetail;
} & AdminVerifiedAgentDetailExtras;

export type AdminVerifiedAgentsListPayload = {
  agents: AdminVerifiedAgentListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};
