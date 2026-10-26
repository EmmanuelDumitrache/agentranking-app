/** Hatcher Explore feed agent row (public API). */
export type HatcherExploreAgent = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  avatarUrl?: string | null;
  framework?: string | null;
  template?: string | null;
  status?: string | null;
  messageCount?: number | null;
  createdAt?: string | null;
  features?: string[] | null;
  isPublic?: boolean | null;
  killed?: boolean | null;
  owner?: {
    username?: string | null;
    walletAddress?: string | null;
  } | null;
  publicChatEnabled?: boolean | null;
};
export type HatcherExplorePagination = {
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
};
export type HatcherExploreResponse = {
  success?: boolean;
  data?: {
    agents?: HatcherExploreAgent[];
    pagination?: HatcherExplorePagination;
  };
};
export type HatcherMetadataSource = "explore" | "partner_feed";
export type HatcherMetadataBadge = "indexed" | "verified";
export type HatcherMetadataOwner = {
  username?: string;
  walletAddressTruncated?: string;
};
export type HatcherMetadata = {
  version: 1;
  hatcherId: string;
  slug: string;
  publicId: string;
  framework: string;
  template: string;
  status: string;
  messageCount: number;
  publicChatEnabled: boolean;
  createdAt?: string;
  owner: HatcherMetadataOwner;
  source: HatcherMetadataSource;
  badge: HatcherMetadataBadge;
  links: {
    profile: string;
    chat: string;
    room: string;
    status: string;
    passport: string;
    mcpManifest: string;
    publicStats: string;
  };
  passportSnapshot?: unknown | null;
  mcpManifestSnapshot?: unknown | null;
  publicStatsSnapshot?: unknown | null;
  lastIndexedAt: string;
  lastDetailFetchAt?: string | null;
  partnerScore?: number;
  partnerScoreBreakdown?: Record<string, number>;
};
export type HatcherDetailPayload = {
  isHatcher: boolean;
  hatcher: HatcherMetadata | null;
  partnerScore: number;
  partnerScoreBreakdown: Record<string, number>;
};
export type HatcherPartnerScoreResult = {
  score: number;
  breakdown: Record<string, number>;
};
