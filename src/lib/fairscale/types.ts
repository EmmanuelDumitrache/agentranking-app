export const FAIRSCALE_ASSESSMENT_STATUSES = [
  "scored",
  "pending",
  "missing_wallet",
  "unsupported_network",
  "temporarily_unavailable",
] as const;

export type FairscaleAssessmentStatus = (typeof FAIRSCALE_ASSESSMENT_STATUSES)[number];

export type FairscaleWalletSource =
  | "custodial"
  | "metadata"
  | "sap_owner"
  | "cluster_sibling";

export type FairscalePillars = {
  verification?: number | null;
  wallet_history?: number | null;
  work_history?: number | null;
  network_quality?: number | null;
  peer_reputation?: number | null;
};

export type FairscaleRecommendation = {
  tier?: string | null;
  label?: string | null;
  color?: string | null;
};

export type FairscaleScoreResponse = {
  wallet?: string;
  score?: number;
  tier?: string | null;
  recommendation?: FairscaleRecommendation | null;
  pillars?: FairscalePillars | null;
  signals?: unknown;
  red_flags?: unknown;
  badges?: unknown;
  description_alignment?: unknown;
  verifications?: unknown;
  meta?: {
    scored_at?: string | null;
    from_cache?: boolean | null;
    provider?: string | null;
  } | null;
  error?: string | null;
};

export type FairscaleBatchResponse = {
  total?: number;
  scored?: number;
  results?: FairscaleScoreResponse[];
  meta?: {
    provider?: string | null;
    scored_at?: string | null;
  } | null;
};

export type FairscalePublicAssessment = {
  status: FairscaleAssessmentStatus;
  walletAddress: string | null;
  walletSource: FairscaleWalletSource | null;
  score: number | null;
  tier: string | null;
  recommendationTier: string | null;
  recommendationLabel: string | null;
  pillars: FairscalePillars | null;
  signals: unknown;
  redFlags: unknown;
  badges: unknown;
  verifications: unknown;
  descriptionAlignment: unknown;
  provider: string | null;
  scoredAt: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  /** When a manual refresh may call FairScale again (once per cache window). */
  nextRefreshAt: string | null;
  fromCache: boolean;
  stale: boolean;
};

/** Human Reputation API — GET api.fairscale.xyz/score */
export type FairscaleHumanScoreResponse = {
  wallet?: string;
  fairscore?: number;
  final_score?: number;
  score?: number;
  fairscore_base?: number;
  social_score?: number;
  peer_score?: number;
  real_world_presence?: number;
  verified_human?: boolean;
  identity_pillar?: number;
  program_pillar?: number;
  ownership_pillar?: number;
  score_composition?: unknown;
  program_memberships?: unknown;
  tier?: string;
  badges?: unknown;
  features?: unknown;
  actions?: unknown;
  timestamp?: string;
  cached?: boolean;
  error?: string | null;
  [key: string]: unknown;
};

export type FairscaleWalletScoreOnlyResponse = {
  wallet_score?: number;
  [key: string]: unknown;
};

export type FairscaleFairScoreOnlyResponse = {
  fair_score?: number;
  fairscore?: number;
  score?: number;
  [key: string]: unknown;
};

export type FairscaleSocialScoreOnlyResponse = {
  social_score?: number;
  [key: string]: unknown;
};
