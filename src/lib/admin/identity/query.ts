type SearchValue = string | string[] | null | undefined;
type SearchInput = Record<string, SearchValue>;

function first(value: SearchValue): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function boundedInteger(value: SearchValue, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(first(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clean(value: SearchValue, max: number): string {
  return first(value).trim().slice(0, max);
}

export type AdminAccountsQuery = {
  page: number;
  perPage: number;
  search: string;
  status: string;
};

export function normalizeAdminAccountsQuery(input: SearchInput): AdminAccountsQuery {
  const status = clean(input.status, 40) || "all";
  return {
    page: boundedInteger(input.page, 1, 1, 100_000),
    perPage: boundedInteger(input.perPage, 25, 1, 100),
    search: clean(input.search, 200),
    status,
  };
}

export function adminAccountsResourceKey(query: AdminAccountsQuery): string {
  return `admin-accounts:${JSON.stringify([query.page, query.perPage, query.status, query.search])}`;
}

export type AdminUsersQuery = {
  page: number;
  perPage: number;
  search: string;
};

export function normalizeAdminUsersQuery(input: SearchInput): AdminUsersQuery {
  return {
    page: boundedInteger(input.page, 1, 1, 100_000),
    perPage: boundedInteger(input.perPage, 20, 1, 50),
    search: clean(input.search, 200),
  };
}

export function adminUsersResourceKey(query: AdminUsersQuery): string {
  return `admin-users:${JSON.stringify([query.page, query.perPage, query.search])}`;
}

export type AdminCreatorsQuery = {
  page: number;
  perPage: number;
  search: string;
  provider: string;
};

const CREATOR_PROVIDERS = new Set(["all", "google", "credentials", "wallet"]);

export function normalizeAdminCreatorsQuery(input: SearchInput): AdminCreatorsQuery {
  const requestedProvider = clean(input.provider, 40) || "all";
  return {
    page: boundedInteger(input.page, 1, 1, 100_000),
    perPage: boundedInteger(input.perPage, 25, 1, 100),
    search: clean(input.search, 200),
    provider: CREATOR_PROVIDERS.has(requestedProvider) ? requestedProvider : "all",
  };
}

export function adminCreatorsResourceKey(query: AdminCreatorsQuery): string {
  return `admin-creators:${JSON.stringify([query.page, query.perPage, query.provider, query.search])}`;
}

export type AdminContactQuery = {
  page: number;
  perPage: number;
  status: "all" | "open" | "resolved";
  dashboardOnly: boolean;
};

export function normalizeAdminContactQuery(input: SearchInput): AdminContactQuery {
  const statusValue = clean(input.status, 20);
  const status = statusValue === "open" || statusValue === "resolved" ? statusValue : "all";
  const dashboardOnly = first(input.dashboardOnly) === "true";
  return {
    page: boundedInteger(input.page, 1, 1, 100_000),
    perPage: boundedInteger(input.perPage, 25, 1, 50),
    status: dashboardOnly ? "all" : status,
    dashboardOnly,
  };
}

export function adminContactResourceKey(query: AdminContactQuery): string {
  const filter = query.dashboardOnly ? "dashboard" : query.status;
  return `admin-contact:${JSON.stringify([query.page, query.perPage, filter])}`;
}

export type AdminVerificationRequestsQuery = {
  page: number;
  perPage: number;
  status: string;
};

export function normalizeAdminVerificationRequestsQuery(input: SearchInput): AdminVerificationRequestsQuery {
  return {
    page: boundedInteger(input.page, 1, 1, 100_000),
    perPage: boundedInteger(input.perPage, 25, 10, 100),
    status: clean(input.status, 100) || "submitted,in_review",
  };
}

export function adminVerificationRequestsResourceKey(
  query: AdminVerificationRequestsQuery,
): string {
  return `admin-verification-requests:${JSON.stringify([query.status, query.page, query.perPage])}`;
}
