import {
  JOB_CATEGORY_FILTERS,
  JOB_MIN_REWARD_FILTERS,
  JOB_POSTED_WITHIN_FILTERS,
  JOB_SORT_OPTIONS,
  PARTNER_JOB_SOURCES,
  type JobCategoryFilter,
  type JobMinRewardFilter,
  type JobPostedWithinFilter,
  type JobSortOption,
  type PartnerJobSource,
} from "@/lib/jobs/types";

export const PUBLIC_JOBS_PER_PAGE = 24;

export type PublicJobsPartnerFilter = "all" | PartnerJobSource;

export type PublicJobsListState = {
  readonly query: string;
  readonly partner: PublicJobsPartnerFilter;
  readonly category: JobCategoryFilter;
  readonly sort: JobSortOption;
  readonly minReward: JobMinRewardFilter;
  readonly postedWithin: JobPostedWithinFilter;
  readonly page: number;
  readonly perPage: number;
};

type SearchParamValue = string | string[] | undefined;

function first(value: SearchParamValue): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function boundedPositiveInt(value: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, parsed);
}

function includesValue<const T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value as T[number]);
}

export function normalizePublicJobsListState(
  params: Readonly<Record<string, SearchParamValue>>,
): PublicJobsListState {
  const source = first(params.source).trim().toLowerCase();
  const category = first(params.category).trim().toLowerCase();
  const sort = first(params.sort).trim().toLowerCase();
  const minReward = first(params.minReward).trim().toLowerCase();
  const postedWithin = first(params.postedWithin).trim().toLowerCase();

  return {
    query: first(params.q).trim().slice(0, 200),
    partner: includesValue(PARTNER_JOB_SOURCES, source) ? source : "all",
    category: includesValue(JOB_CATEGORY_FILTERS, category) ? category : "all",
    sort: includesValue(JOB_SORT_OPTIONS, sort) ? sort : "best",
    minReward: includesValue(JOB_MIN_REWARD_FILTERS, minReward) ? minReward : "any",
    postedWithin: includesValue(JOB_POSTED_WITHIN_FILTERS, postedWithin)
      ? postedWithin
      : "all",
    page: boundedPositiveInt(first(params.page), 1, 10_000),
    perPage: boundedPositiveInt(first(params.perPage), PUBLIC_JOBS_PER_PAGE, 50),
  };
}

export function publicJobsListParams(state: PublicJobsListState, page = state.page) {
  return {
    source: state.partner === "all" ? undefined : state.partner,
    category: state.category,
    q: state.query || undefined,
    sort: state.sort,
    minReward: state.minReward,
    postedWithin: state.postedWithin,
    page,
    perPage: state.perPage,
  } as const;
}

export function publicJobsResourceKey(state: PublicJobsListState, page = 1): string {
  return JSON.stringify([
    "jobs",
    state.partner,
    state.category,
    state.sort,
    state.minReward,
    state.postedWithin,
    state.query,
    page,
    state.perPage,
  ]);
}

export function buildPublicJobsApiUrl(state: PublicJobsListState, page: number): string {
  const params = new URLSearchParams({
    category: state.category,
    sort: state.sort,
    minReward: state.minReward,
    postedWithin: state.postedWithin,
    perPage: String(state.perPage),
    page: String(page),
  });
  if (state.query) params.set("q", state.query);
  if (state.partner !== "all") params.set("source", state.partner);
  return `/api/jobs?${params.toString()}`;
}
