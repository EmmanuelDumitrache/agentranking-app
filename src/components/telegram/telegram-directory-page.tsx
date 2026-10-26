"use client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { TelegramDirectoryToolbar } from "@/components/telegram/telegram-directory-toolbar";
import { TelegramDirectoryFilters } from "@/components/telegram/telegram-directory-filters";
import {
  TelegramDirectoryTable,
} from "@/components/telegram/telegram-directory-table";
import type { TelegramDirectoryQuery, TelegramDirectoryResponse } from "@/lib/agent-directory/telegram-directory";
import { normalizeTelegramDirectoryQuery, telegramDirectoryQueryKey } from "@/lib/agent-directory/telegram-directory";
import { useDebounce } from "@/hooks/use-debounce";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { agentsListRetryDelay, shouldRetryAgentsListQuery } from "@/lib/agents-query-retry";
import {
  getAgentListSearchHint,
  resolveAgentListSearchForApi,
} from "@/lib/agents-search-scope";
import { fetchWithQuerySignal } from "@/lib/fetch-with-query-signal";
const LIST_POLL_VISIBLE_MS = 90_000;
function TelegramDirectoryContent({
  initialData,
  initialQuery,
}: {
  readonly initialData: TelegramDirectoryResponse;
  readonly initialQuery: TelegramDirectoryQuery;
}) {
  const isVisible = usePageVisibility();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [search, setSearch] = useState(initialQuery.search);
  const [showFilters, setShowFilters] = useState(false);
  const debouncedSearch = useDebounce(search, 400);
  const apiSearch = resolveAgentListSearchForApi(debouncedSearch);
  const searchPending = debouncedSearch.trim().length > 0 && apiSearch.length === 0;
  const normalizedUrlQuery = normalizeTelegramDirectoryQuery(
    Object.fromEntries(searchParams.entries()),
  );
  const currentPage = normalizedUrlQuery.page;
  const currentSort = normalizedUrlQuery.sort;
  const currentPerPage = String(normalizedUrlQuery.perPage);
  const currentVerified = normalizedUrlQuery.verified;
  const currentBotType = normalizedUrlQuery.botType;
  const currentSpawn = normalizedUrlQuery.spawn;
  const currentTag = normalizedUrlQuery.tag;
  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v) params.set(k, v);
        else params.delete(k);
      });
      router.push(`/telegram?${params.toString()}`);
    },
    [searchParams, router],
  );
  useEffect(() => {
    const urlQ = (searchParams.get("search") || "").trim();
    if (apiSearch === urlQ) return;
    updateParams({ search: apiSearch, page: "1" });
  }, [apiSearch, searchParams, updateParams]);
  const currentQuery: TelegramDirectoryQuery = {
    page: currentPage,
    perPage: normalizedUrlQuery.perPage,
    search: apiSearch,
    sort: currentSort,
    verified: currentVerified,
    botType: currentBotType,
    spawn: currentSpawn,
    tag: currentTag,
  };
  const isInitialQuery = telegramDirectoryQueryKey(currentQuery).every(
    (part, index) => part === telegramDirectoryQueryKey(initialQuery)[index],
  );
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<TelegramDirectoryResponse>({
    queryKey: telegramDirectoryQueryKey(currentQuery),
    refetchInterval: (q) =>
      q.state.status === "error" ? false : isVisible ? LIST_POLL_VISIBLE_MS : 10 * 60 * 1000,
    refetchIntervalInBackground: false,
    staleTime: 45_000,
    initialData: isInitialQuery ? initialData : undefined,
    initialDataUpdatedAt: isInitialQuery ? Date.parse(initialData.generatedAt) : undefined,
    refetchOnMount: false,
    retry: shouldRetryAgentsListQuery,
    retryDelay: agentsListRetryDelay,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        page: String(currentPage),
        perPage: currentPerPage,
        sort: currentSort,
        listView: "true",
        archetype: "telegram",
      });
      if (apiSearch) params.set("search", apiSearch);
      if (currentVerified) params.set("verified", currentVerified);
      if (currentBotType) params.set("telegramBotType", currentBotType);
      if (currentSpawn) params.set("telegramSpawn", currentSpawn);
      if (currentTag) params.set("tag", currentTag);
      const r = await fetchWithQuerySignal(`/api/agents?${params}`, signal, 60_000);
      if (!r.ok) {
        const body = await r.text();
        throw new Error(body || `Failed to load Telegram bots (${r.status})`);
      }
      const payload = (await r.json()) as Omit<TelegramDirectoryResponse, "generatedAt"> &
        Partial<Pick<TelegramDirectoryResponse, "generatedAt">>;
      return { ...payload, generatedAt: payload.generatedAt ?? new Date().toISOString() };
    },
  });
  const activeFilterCount = [
    currentVerified,
    currentBotType,
    currentSpawn,
    currentTag,
    currentSort !== "profile_desc" ? currentSort : "",
  ].filter(Boolean).length;
  const clearFilters = () => {
    setSearch("");
    updateParams({
      verified: "",
      telegramBotType: "",
      telegramSpawn: "",
      tag: "",
      sort: "profile_desc",
      search: "",
      page: "1",
    });
    setShowFilters(false);
  };
  return (
    <PublicSitePageShell fullBleed className="telegram-directory-page">
      <div className="telegram-directory-panel">
        <TelegramDirectoryToolbar
          total={data?.total ?? null}
          isRefreshing={isLoading || isFetching}
          onRefresh={() => void refetch()}
        />
        <TelegramDirectoryFilters
          search={search}
          onSearchChange={setSearch}
          botType={currentBotType}
          verified={currentVerified}
          spawnable={currentSpawn}
          tag={currentTag}
          sort={currentSort}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters((v) => !v)}
          activeFilterCount={activeFilterCount}
          onUpdate={updateParams}
          onClear={clearFilters}
        />
        {searchPending ? (
          <p className="telegram-directory-hint">{getAgentListSearchHint(search)}</p>
        ) : null}
        <TelegramDirectoryTable
          agents={data?.agents ?? []}
          isLoading={isLoading}
          isError={isError}
          errorMessage={error instanceof Error ? error.message : undefined}
        />
        {data && data.total > 0 ? (
          <div className="telegram-directory-pagination">
            <p className="telegram-directory-pagination-meta">
              Showing {(data.page - 1) * data.perPage + 1}–
              {Math.min(data.page * data.perPage, data.total)} of {data.total.toLocaleString()}
            </p>
            <div className="telegram-directory-pagination-controls">
              <Select
                value={currentPerPage}
                onValueChange={(v: string) => updateParams({ perPage: v, page: "1" })}
              >
                <SelectTrigger className="telegram-directory-per-page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => updateParams({ page: String(data.page - 1) })}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="telegram-directory-page-label">
                {data.page} / {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => updateParams({ page: String(data.page + 1) })}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </PublicSitePageShell>
  );
}
export function TelegramDirectoryPage({ initialData, initialQuery }: { readonly initialData: TelegramDirectoryResponse; readonly initialQuery: TelegramDirectoryQuery }) {
  return (
    <Suspense
      fallback={
        <PublicSitePageShell fullBleed className="telegram-directory-page">
          <div className="telegram-directory-panel" aria-busy="true" aria-label="Loading Telegram bots">
            <div className="telegram-directory-skeleton telegram-directory-skeleton--page" />
          </div>
        </PublicSitePageShell>
      }
    >
      <TelegramDirectoryContent initialData={initialData} initialQuery={initialQuery} />
    </Suspense>
  );
}
