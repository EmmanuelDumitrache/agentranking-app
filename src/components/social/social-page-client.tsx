"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { SocialPageHeader } from "@/components/social/social-page-header";
import { SocialToolbar } from "@/components/social/social-toolbar";
import { SocialFeaturedRow } from "@/components/social/social-featured-row";
import { SocialProfileDirectory } from "@/components/social/social-profile-directory";
import { fetchJsonWithQuerySignal } from "@/lib/fetch-with-query-signal";
import type {
  SocialProfileFilter,
  SocialProfilesResponse,
} from "@/components/social/social-types";
import type { SocialViewerSnapshot } from "@/components/social/social-types";
const STALE_MS = 2 * 60_000;
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
export function SocialPageClient({
  initialPage,
  initialFeatured,
  initialViewer,
  initialFilter,
  initialSearch,
}: {
  readonly initialPage: SocialProfilesResponse;
  readonly initialFeatured: SocialProfilesResponse;
  readonly initialViewer: SocialViewerSnapshot;
  readonly initialFilter: SocialProfileFilter;
  readonly initialSearch: string;
}) {
  const [filter, setFilter] = useState<SocialProfileFilter>(initialFilter);
  const [search, setSearch] = useState(initialSearch);
  const debouncedSearch = useDebouncedValue(search, 300);
  const queryKey = ["social-profiles", filter, debouncedSearch];
  const usesInitialPage = filter === initialFilter && debouncedSearch === initialSearch;
  const {
    data,
    isPending,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<SocialProfilesResponse>({
    queryKey,
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => {
      const page = Number(pageParam);
      const params = new URLSearchParams({
        page: String(page),
        perPage: "20",
        filter,
        stats: "true",
      });
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      return fetchJsonWithQuerySignal(`/api/social/profiles?${params}`, signal);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    staleTime: STALE_MS,
    initialData: usesInitialPage ? { pages: [initialPage], pageParams: [initialPage.page] } : undefined,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const pages = useMemo(() => data?.pages ?? [], [data?.pages]);
  const allProfiles = useMemo(() => {
    const profiles = pages.flatMap((page) => page.profiles);
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    return [...byId.values()];
  }, [pages]);
  const latestPage = pages.at(-1);
  const { data: featuredData } = useQuery<SocialProfilesResponse>({
    queryKey: ["social-profiles-featured", filter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        featured: "true",
        perPage: "12",
        filter,
        stats: "false",
      });
      return fetchJsonWithQuerySignal(`/api/social/profiles?${params}`, signal);
    },
    staleTime: STALE_MS,
    initialData: filter === initialFilter ? initialFeatured : undefined,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: !isPending || pages.length > 0,
  });
  const loadMore = useCallback(() => {
    if (!isFetchingNextPage && hasNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  const emptyMessage = useMemo(() => {
    if (debouncedSearch.trim()) return "No profiles match your search.";
    if (filter === "verified") return "No verified builders in the directory yet.";
    if (filter === "creators") return "No agent creators with linked agents yet.";
    if (filter === "sap") return "No SAP builders found.";
    if (filter === "x402") return "No x402 builders found.";
    if (filter === "active") return "No recently active profiles.";
    if (filter === "high_reputation") return "No high-reputation builders yet.";
    return "No profiles found.";
  }, [filter, debouncedSearch]);
  return (
    <PublicSitePageShell className="social-page-shell">
      <div className="social-page">
        <SocialPageHeader stats={pages[0]?.stats ?? null} />
        <SocialToolbar
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
        />
        <SocialFeaturedRow profiles={featuredData?.profiles ?? []} initialViewer={initialViewer} />
        <SocialProfileDirectory
          profiles={allProfiles}
          total={latestPage?.total ?? 0}
          totalIsExact={latestPage?.totalIsExact ?? true}
          isLoading={isPending && allProfiles.length === 0}
          isError={isError}
          onRetry={() => void refetch()}
          hasMore={Boolean(hasNextPage)}
          onLoadMore={loadMore}
          loadingMore={isFetchingNextPage}
          emptyMessage={emptyMessage}
          initialViewer={initialViewer}
        />
      </div>
    </PublicSitePageShell>
  );
}
