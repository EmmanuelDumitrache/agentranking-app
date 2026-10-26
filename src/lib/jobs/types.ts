export const PARTNER_JOB_SOURCES = ["earnfi", "wurk"] as const;
export type PartnerJobSource = (typeof PARTNER_JOB_SOURCES)[number];
export const WORK_READY_STATUSES = ["none", "pending", "approved"] as const;
export const JOB_INTERACTION_EVENT_TYPES = [
  "job_viewed",
  "job_clicked",
  "partner_job_opened",
  "matching_agents_clicked",
  "work_ready_agent_clicked",
] as const;
export type JobInteractionEventType = (typeof JOB_INTERACTION_EVENT_TYPES)[number];
export const JOB_CATEGORY_FILTERS = [
  "all",
  "earnfi",
  "wurk",
  "social",
  "human_feedback",
  "research",
  "data",
  "growth",
  "contests",
  "manual",
  "on_chain",
] as const;
export type JobCategoryFilter = (typeof JOB_CATEGORY_FILTERS)[number];
export const JOB_SORT_OPTIONS = ["best", "reward_desc", "newest", "reward_asc", "oldest"] as const;
export type JobSortOption = (typeof JOB_SORT_OPTIONS)[number];
export const JOB_MIN_REWARD_FILTERS = ["any", "0.1", "1", "10"] as const;
export type JobMinRewardFilter = (typeof JOB_MIN_REWARD_FILTERS)[number];
export const JOB_POSTED_WITHIN_FILTERS = ["all", "24h", "7d", "30d"] as const;
export type JobPostedWithinFilter = (typeof JOB_POSTED_WITHIN_FILTERS)[number];
export const JOB_INGESTION_MODES = ["api", "feed", "manual", "seed"] as const;
export type JobIngestionMode = (typeof JOB_INGESTION_MODES)[number];
export type PartnerJobUpsertInput = {
  source: PartnerJobSource;
  externalId: string;
  title: string;
  description: string;
  category: string;
  jobType: string;
  rewardAmount: string | null;
  rewardCurrency: string;
  chain: string;
  status: string;
  applyUrl: string;
  sourceJobUrl: string;
  sourceStatusUrl: string | null;
  sourceSecret: string | null;
  requirements: unknown;
  tags: string[];
  /** Semantic category facets (social/human_feedback/research/data/growth/contests/manual/on_chain) for SQL filtering. */
  facets: string[];
  raw: unknown;
  expiresAt: Date | null;
  ingestionMode?: JobIngestionMode;
  featured?: boolean;
  curatedBy?: string | null;
  isSample?: boolean;
};
export type PublicPartnerJob = {
  id: string;
  source: string;
  externalId: string;
  title: string;
  description: string;
  category: string;
  jobType: string;
  rewardAmount: string | null;
  rewardCurrency: string;
  chain: string;
  status: string;
  applyUrl: string;
  sourceJobUrl: string;
  sourceStatusUrl: string | null;
  requirements: unknown;
  tags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string | null;
  partnerDisplayName: string;
  agentReady: boolean;
  ingestionMode: string;
  featured: boolean;
  curatedListing: boolean;
};
export type PartnerSyncResult = {
  source: PartnerJobSource;
  ok: boolean;
  fetched: number;
  upserted: number;
  staleClosed: number;
  error?: string;
};