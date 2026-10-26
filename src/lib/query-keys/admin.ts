/**
 * Admin portal Query Key Factory.
 *
 * Every pagination/search/status/filter argument belongs in its list key so
 * each distinct filter combination caches independently. Mutable objects must
 * never be placed directly into a key — use the normalization helpers below to
 * produce a stable, serializable snapshot first.
 */
export type AdminAccountFilters = {
  readonly page?: number;
  readonly pageSize?: number;
  readonly perPage?: number;
  readonly query?: string;
  readonly status?: string;
  readonly sort?: string;
};

export type AdminUserFilters = {
  readonly page?: number;
  readonly pageSize?: number;
  readonly perPage?: number;
  readonly query?: string;
};

export type AdminDaoVoteFilters = {
  readonly page?: number;
  readonly perPage?: number;
  readonly query?: string;
  readonly scope?: string;
};

export type AdminCreatorFilters = {
  readonly page?: number;
  readonly pageSize?: number;
  readonly perPage?: number;
  readonly query?: string;
  readonly status?: string;
};

export type AdminVerificationRequestFilters = {
  readonly page?: number;
  readonly pageSize?: number;
  readonly perPage?: number;
  readonly status?: string;
};

export type AdminReportFilters = {
  readonly page?: number;
  readonly pageSize?: number;
  readonly perPage?: number;
  readonly status?: string;
  readonly type?: string;
};

export type AdminArTokenStakePositionFilters = {
  readonly page?: number;
  readonly pageSize?: number;
  readonly wallet?: string;
  readonly status?: string;
};

export type AdminArTokenStakeOverrideFilters = {
  readonly page?: number;
  readonly pageSize?: number;
};

export type AdminArTokenHolderAllocationFilters = {
  readonly page?: number;
  readonly pageSize?: number;
  readonly wallet?: string;
};

function normalizeFilters<T extends Record<string, unknown>>(
  filters: T,
): T {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.trim() === "") continue;
    normalized[key] = value;
  }
  return normalized as T;
}

export const adminKeys = {
  all: ["admin"] as const,

  dashboard: () => [...adminKeys.all, "dashboard"] as const,

  accountsRoot: () => [...adminKeys.all, "accounts"] as const,

  accounts: (filters: AdminAccountFilters) =>
    [...adminKeys.accountsRoot(), normalizeFilters(filters)] as const,

  account: (accountId: number) =>
    [...adminKeys.accountsRoot(), accountId] as const,

  accountAgents: (accountId: number) =>
    [...adminKeys.account(accountId), "agents"] as const,

  usersRoot: () => [...adminKeys.all, "users"] as const,

  users: (filters: AdminUserFilters) =>
    [...adminKeys.usersRoot(), normalizeFilters(filters)] as const,

  user: (wallet: string) => [...adminKeys.usersRoot(), wallet] as const,

  userAgents: (wallet: string) => [...adminKeys.user(wallet), "agents"] as const,

  ads: (filters: AdminAccountFilters = {}) =>
    [...adminKeys.all, "ads", normalizeFilters(filters)] as const,

  agentBlocklist: () => [...adminKeys.all, "agent-blocklist"] as const,

  mcpOperations: () => [...adminKeys.all, "mcp-operations"] as const,

  mcpPolicies: () => [...adminKeys.mcpOperations(), "policies"] as const,

  mcpConnections: () => [...adminKeys.mcpOperations(), "connections"] as const,

  agentReports: (filters: AdminReportFilters = {}) =>
    [...adminKeys.all, "agent-reports", normalizeFilters(filters)] as const,

  creatorsRoot: () => [...adminKeys.all, "creators"] as const,

  creators: (filters: AdminCreatorFilters = {}) =>
    [...adminKeys.creatorsRoot(), normalizeFilters(filters)] as const,

  creator: (id: string) => [...adminKeys.creatorsRoot(), id] as const,

  creatorAgents: (id: string) => [...adminKeys.creator(id), "agents"] as const,

  creatorLaunches: (id: string) =>
    [...adminKeys.creator(id), "launches"] as const,

  verificationRequests: (filters: AdminVerificationRequestFilters = {}) =>
    [...adminKeys.all, "verification-requests", normalizeFilters(filters)] as const,

  contactInquiries: () => [...adminKeys.all, "contact-inquiries"] as const,

  jobs: () => [...adminKeys.all, "jobs"] as const,

  orders: (filters: AdminAccountFilters = {}) =>
    [...adminKeys.all, "orders", normalizeFilters(filters)] as const,

  daoVotes: (filters: AdminDaoVoteFilters = {}) =>
    [...adminKeys.all, "dao-votes", normalizeFilters(filters)] as const,

  arToken: () => [...adminKeys.all, "ar-token"] as const,

  arTokenCommissions: (status?: string) =>
    [
      ...adminKeys.arToken(),
      "commissions",
      normalizeFilters(status ? { status } : {}),
    ] as const,

  arTokenStakeRules: () => [...adminKeys.arToken(), "stake-rules"] as const,

  arTokenStakePositions: (filters: AdminArTokenStakePositionFilters = {}) =>
    [...adminKeys.arToken(), "stake-positions", normalizeFilters(filters)] as const,

  arTokenStakeOverrides: (filters: AdminArTokenStakeOverrideFilters = {}) =>
    [...adminKeys.arToken(), "stake-overrides", normalizeFilters(filters)] as const,

  arTokenHolderAllocations: (
    filters: AdminArTokenHolderAllocationFilters = {},
  ) => [...adminKeys.arToken(), "holder-allocations", normalizeFilters(filters)] as const,

  arTokenPerksPreview: () => [...adminKeys.arToken(), "perks-preview"] as const,
} as const;
