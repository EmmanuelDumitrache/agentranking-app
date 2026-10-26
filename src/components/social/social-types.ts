import type { BuilderReputationResult } from "@/lib/builder-reputation";
import type { ProfileAgentAggregate } from "@/lib/profile-summary";
export type SocialProfileFilter =
  | "all"
  | "verified"
  | "creators"
  | "high_reputation"
  | "sap"
  | "x402"
  | "active";
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
export type SocialHubStats = {
  totalProfiles: number;
  verifiedProfiles: number;
  claimedAgents: number;
  avgArScore: number | null;
};
export type SocialProfilesResponse = {
  profiles: SocialProfileListItem[];
  total: number;
  totalPages: number;
  hasMore: boolean;
  totalIsExact: boolean;
  page: number;
  perPage: number;
  filter: SocialProfileFilter;
  stats: SocialHubStats | null;
};
export const SOCIAL_FILTERS: ReadonlyArray<{ id: SocialProfileFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "verified", label: "Verified" },
  { id: "creators", label: "Agent creators" },
  { id: "high_reputation", label: "High reputation" },
  { id: "sap", label: "SAP builders" },
  { id: "x402", label: "x402 builders" },
  { id: "active", label: "Recently active" },
];
export type SocialViewerSnapshot = {
  followerAddress: string | null;
  followingByWallet: Record<string, boolean>;
};
