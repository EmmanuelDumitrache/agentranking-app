/**
 * Public site Query Key Factory.
 *
 * Covers server-state resources on routes served by `PublicQueryProviders` and
 * wallet-owned providers (launch, profile follow, referral stats).
 */
export type PublicJobsFilters = {
  readonly query?: string;
  readonly partner?: string;
  readonly category?: string;
  readonly sort?: string;
  readonly minReward?: string;
  readonly postedWithin?: string;
  readonly perPage?: number;
};

function normalizeFilters<T extends Record<string, unknown>>(
  filters: T,
): T {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.trim() === "") continue;
    if (value === undefined) continue;
    normalized[key] = value;
  }
  return normalized as T;
}

export const publicKeys = {
  all: ["public"] as const,

  jobs: (filters: PublicJobsFilters = {}) =>
    [...publicKeys.all, "jobs", normalizeFilters(filters)] as const,

  workReadyAgents: () => [...publicKeys.all, "jobs", "work-ready-agents"] as const,

  sap: () => [...publicKeys.all, "sap"] as const,

  sapLeaderboard: (mode: string) =>
    [...publicKeys.sap(), "leaderboard", mode] as const,

  sapCompare: (a: string, b: string) =>
    [...publicKeys.sap(), "compare", a, b] as const,

  metaplex: () => [...publicKeys.all, "metaplex"] as const,

  metaplexAdminHub: () => [...publicKeys.metaplex(), "admin-hub"] as const,

  robinhood: () => [...publicKeys.all, "robinhood"] as const,

  robinhoodLaunch: (address: string) =>
    [...publicKeys.robinhood(), "launch", address] as const,

  verification: () => [...publicKeys.all, "verification"] as const,

  passport: (id: string) => [...publicKeys.verification(), "passport", id] as const,

  referralStats: () => [...publicKeys.all, "referral-stats"] as const,

  profile: (address: string) => [...publicKeys.all, "profile", address] as const,

  profileFollowStatus: (address: string) =>
    [...publicKeys.profile(address), "follow-status"] as const,

  launchResource: (resourceKey: string) =>
    [...publicKeys.all, "launch-resource", resourceKey] as const,
} as const;