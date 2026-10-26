"use client";
import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BriefcaseBusiness, ChevronDown, Loader2, Search } from "lucide-react";
import { PartnerJobCard } from "@/components/jobs/partner-job-card";
import { PartnerLogo } from "@/components/jobs/partner-logo";
import {
  PartnerSourceCards,
  buildPartnerSourceCardsFromApi,
  defaultPartnerSourceCards,
  type PartnerSourceCardData,
} from "@/components/jobs/partner-source-cards";
import { WurkServiceCatalogPanel } from "@/components/jobs/wurk-service-catalog-panel";
import {
  WorkReadyAgentCard,
  type WorkReadyAgentCardData,
} from "@/components/jobs/work-ready-agent-card";
import {
  buildPublicJobsApiUrl,
  type PublicJobsListState,
} from "@/lib/jobs/public-list-state";
import { publicKeys, type PublicJobsFilters } from "@/lib/query-keys/public";
import type {
  JobCategoryFilter,
  JobMinRewardFilter,
  JobPostedWithinFilter,
  JobSortOption,
  PublicPartnerJob,
} from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
const PARTNER_TABS = [
  { id: "all", label: "All partners" },
  { id: "earnfi", label: "EarnFi" },
  { id: "wurk", label: "WURK" },
] as const;
type PartnerTab = (typeof PARTNER_TABS)[number]["id"];
const CATEGORY_FILTERS: { id: JobCategoryFilter; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "social", label: "Social" },
  { id: "human_feedback", label: "Human feedback" },
  { id: "research", label: "Research" },
  { id: "growth", label: "Growth" },
  { id: "contests", label: "Contests" },
];
const SORTS: { id: JobSortOption; label: string }[] = [
  { id: "best", label: "Recommended" },
  { id: "reward_desc", label: "Highest payout" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "reward_asc", label: "Lowest payout" },
];
const MIN_REWARD_FILTERS: { id: JobMinRewardFilter; label: string }[] = [
  { id: "any", label: "Any payout" },
  { id: "0.1", label: "$0.10+" },
  { id: "1", label: "$1+" },
  { id: "10", label: "$10+" },
];
const POSTED_WITHIN_FILTERS: { id: JobPostedWithinFilter; label: string }[] = [
  { id: "all", label: "Any age" },
  { id: "24h", label: "Last 24h" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];
type JobsApiResponse = {
  jobs?: PublicPartnerJob[];
  lastSyncedAt?: string | null;
  partners?: PartnerSourceCardData[];
  pagination?: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
};
type Props = {
  readonly initialState: PublicJobsListState;
  readonly initialJobs: JobsApiResponse;
  readonly initialWorkReadyAgents: WorkReadyAgentCardData[];
};
export function JobsPageClient({
  initialState,
  initialJobs,
  initialWorkReadyAgents,
}: Props) {
  const [query, setQuery] = useState(initialState.query);
  const [partnerTab, setPartnerTab] = useState<PartnerTab>(initialState.partner);
  const [categoryFilter, setCategoryFilter] = useState<JobCategoryFilter>(initialState.category);
  const [sort, setSort] = useState<JobSortOption>(initialState.sort);
  const [minReward, setMinReward] = useState<JobMinRewardFilter>(initialState.minReward);
  const [postedWithin, setPostedWithin] = useState<JobPostedWithinFilter>(initialState.postedWithin);
  const state = useMemo<PublicJobsListState>(() => {
    const normalizedQuery = query.trim();
    const matchesInitialFilters =
      normalizedQuery === initialState.query
      && partnerTab === initialState.partner
      && categoryFilter === initialState.category
      && sort === initialState.sort
      && minReward === initialState.minReward
      && postedWithin === initialState.postedWithin;
    return {
      query: normalizedQuery,
      partner: partnerTab,
      category: categoryFilter,
      sort,
      minReward,
      postedWithin,
      page: matchesInitialFilters ? initialState.page : 1,
      perPage: initialState.perPage,
    };
  }, [categoryFilter, initialState, minReward, partnerTab, postedWithin, query, sort]);
  const matchesInitialFilters =
    state.query === initialState.query
    && state.partner === initialState.partner
    && state.category === initialState.category
    && state.sort === initialState.sort
    && state.minReward === initialState.minReward
    && state.postedWithin === initialState.postedWithin;
  const initialPageParam = state.page;
  const jobsFilters: PublicJobsFilters = {
    query: state.query || undefined,
    partner: state.partner,
    category: state.category,
    sort: state.sort,
    minReward: state.minReward,
    postedWithin: state.postedWithin,
    perPage: state.perPage,
  };
  const jobsQuery = useInfiniteQuery({
    queryKey: publicKeys.jobs(jobsFilters),
    initialPageParam,
    initialData: matchesInitialFilters
      ? { pages: [initialJobs], pageParams: [initialPageParam] }
      : undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await fetch(buildPublicJobsApiUrl(state, pageParam), {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(`Jobs request failed (${response.status})`);
      return (await response.json()) as JobsApiResponse;
    },
    getNextPageParam: (lastPage) => {
      const pagination = lastPage.pagination;
      if (!pagination) return undefined;
      return pagination.page < pagination.totalPages
        ? pagination.page + 1
        : undefined;
    },
  });
  const pages = jobsQuery.data?.pages ?? [];
  const jobs = pages.flatMap((pageData) => pageData.jobs ?? []);
  const lastPage = pages[pages.length - 1];
  const totalJobs = lastPage?.pagination?.total ?? jobs.length;
  const totalPages = lastPage?.pagination?.totalPages ?? 0;
  const page = lastPage?.pagination?.page ?? state.page;
  const hasMore = jobsQuery.hasNextPage ?? page < totalPages;
  const lastSyncedAt = lastPage?.lastSyncedAt ?? null;
  const partners =
    lastPage?.partners?.length
      ? buildPartnerSourceCardsFromApi(lastPage.partners)
      : defaultPartnerSourceCards();
  const loadingMore = jobsQuery.isFetchingNextPage;
  const agentsQuery = useQuery({
    queryKey: publicKeys.workReadyAgents(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/jobs/work-ready-agents", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(`Agent request failed (${response.status})`);
      const data = (await response.json()) as { agents?: WorkReadyAgentCardData[] };
      return data.agents ?? [];
    },
    initialData: initialWorkReadyAgents,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });
  const agents = agentsQuery.data ?? [];
  const loading = jobsQuery.isPending;
  const loadMore = () => {
    if (jobsQuery.isFetchingNextPage || !hasMore) return;
    void jobsQuery.fetchNextPage();
  };
  const lastSyncedLabel = useMemo(() => {
    if (!lastSyncedAt) return null;
    try {
      return new Date(lastSyncedAt).toLocaleString();
    } catch {
      return lastSyncedAt;
    }
  }, [lastSyncedAt]);
  const wurkPartner = useMemo(() => partners.find((p) => p.source === "wurk"), [partners]);
  const showWurkCatalog =
    (wurkPartner?.jobCount ?? 0) === 0 && wurkPartner?.displayStatus !== "active";
  const emptyMessage = useMemo(() => {
    if (partnerTab === "wurk" && (wurkPartner?.jobCount ?? 0) === 0) {
      return "No WURK listings synced yet. Production syncs partner jobs every 15 minutes.";
    }
    if (partnerTab === "earnfi") {
      return "No EarnFi listings match your filters. Try clearing search or category filters.";
    }
    return "No jobs match your filters. Try another partner, category, or search term.";
  }, [partnerTab, wurkPartner?.jobCount]);
  return (
    <div className="jobs-layout">
      <div className="jobs-main">
        <div className="jobs-toolbar">
          <div className="jobs-toolbar-search-row">
            <div className="jobs-search-wrap">
              <Search className="jobs-search-icon" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search jobs…"
                className="jobs-search-input"
              />
            </div>
            <div className="jobs-toolbar-selects">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as JobSortOption)}
                className="ar-select jobs-select"
                aria-label="Sort jobs"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={minReward}
                onChange={(e) => setMinReward(e.target.value as JobMinRewardFilter)}
                className="ar-select jobs-select"
                aria-label="Minimum payout"
              >
                {MIN_REWARD_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={postedWithin}
                onChange={(e) => setPostedWithin(e.target.value as JobPostedWithinFilter)}
                className="ar-select jobs-select"
                aria-label="Posted within"
              >
                {POSTED_WITHIN_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="ar-toolbar-row">
            <span className="ar-toolbar-label">Partner</span>
            <div className="jobs-chip-row">
              {PARTNER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPartnerTab(tab.id)}
                  className={cn("ar-chip", partnerTab === tab.id && "ar-chip-active")}
                >
                  {tab.id === "earnfi" ? (
                    <PartnerLogo source="earnfi" variant="icon" size="xs" className="!gap-0" />
                  ) : null}
                  {tab.id === "wurk" ? (
                    <PartnerLogo source="wurk" variant="icon" size="xs" className="!gap-0" />
                  ) : null}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ar-toolbar-row">
            <span className="ar-toolbar-label">Type</span>
            <div className="jobs-chip-row">
              {CATEGORY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setCategoryFilter(f.id)}
                  className={cn("ar-chip jobs-type-chip", categoryFilter === f.id && "ar-chip-active")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {jobsQuery.error ? (
          <p className="text-sm text-destructive">{jobsQuery.error.message}</p>
        ) : null}
        {!loading && totalJobs > 0 ? (
          <p className="jobs-meta-line">
            Showing {jobs.length} of {totalJobs} open listings
            {lastSyncedLabel ? ` · synced ${lastSyncedLabel}` : null}
          </p>
        ) : null}
        {loading ? (
          <div className="jobs-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="jobs-skeleton" aria-hidden />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="jobs-empty">
            <BriefcaseBusiness className="jobs-empty-icon" aria-hidden />
            <p className="jobs-empty-title">No listings found</p>
            <p className="jobs-empty-copy">{emptyMessage}</p>
          </div>
        ) : (
          <>
            <div className="jobs-grid">
              {jobs.map((job) => (
                <PartnerJobCard key={job.id} job={job} />
              ))}
            </div>
            {hasMore ? (
              <div className="jobs-load-more">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  className="ar-btn ar-btn-secondary jobs-load-more-btn"
                >
                  {loadingMore ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <aside className="jobs-sidebar">
        <section id="work-ready" className="jobs-sidebar-panel">
          <h2 className="jobs-sidebar-title">Work-ready agents</h2>
          <p className="jobs-sidebar-subcopy">
            Verified agents for campaigns and execution workflows.
          </p>
          <div className="jobs-sidebar-list">
            {agents.length === 0 ? (
              <p className="jobs-sidebar-empty">
                None featured yet.{" "}
                <Link href="/verified" className="jobs-text-link">
                  Browse verified agents
                </Link>
              </p>
            ) : (
              agents.slice(0, 5).map((agent) => <WorkReadyAgentCard key={agent.id} agent={agent} />)
            )}
          </div>
        </section>
        <PartnerSourceCards partners={partners} compact />
        {showWurkCatalog ? <WurkServiceCatalogPanel compact /> : null}
      </aside>
    </div>
  );
}
