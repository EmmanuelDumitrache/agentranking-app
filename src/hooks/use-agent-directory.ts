"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useDebounce } from "@/hooks/use-debounce";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { agentsListRetryDelay, shouldRetryAgentsListQuery } from "@/lib/agents-query-retry";
import {
  getAgentListSearchHint,
  resolveAgentListSearchForApi,
  type AgentsSearchScope,
} from "@/lib/agents-search-scope";
import {
  parseSocialsQueryParam,
} from "@/lib/agent-social-filter";
import type {
  DirectoryAgentListResponse,
  DirectoryTimeWindow,
  DirectoryViewId,
} from "@/lib/agent-directory/types";
import { countDirectoryActiveFilters } from "@/lib/agent-directory/filters";
import { agentDirectoryRefetchInterval } from "@/lib/agent-directory/polling";
import { fetchJsonWithQuerySignal, fetchWithQuerySignal } from "@/lib/fetch-with-query-signal";
import { useEcosystemStats } from "@/hooks/use-ecosystem-stats";
export function useAgentDirectory() {
  useAutoSync({ withFeedback: true });
  const isVisible = usePageVisibility();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 200);
  const apiSearch = resolveAgentListSearchForApi(debouncedSearch);
  const searchPending = debouncedSearch.trim().length > 0 && apiSearch.length === 0;
  const mountedAtMs = useRef<number | null>(null);
  useEffect(() => {
    mountedAtMs.current = Date.now();
  }, []);
  const [view, setView] = useState<DirectoryViewId>("directory");
  const currentPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const currentSort = searchParams.get("sort") || "agent_rank_desc";
  const currentChain = searchParams.get("chain") || "";
  const currentService = searchParams.get("service") || "";
  const currentPerPage = searchParams.get("perPage") || "50";
  const currentX402 = searchParams.get("x402") || "";
  const currentHasWallet = searchParams.get("hasWallet") || "";
  const currentVerified = searchParams.get("verified") || "";
  const currentXpay = searchParams.get("xpay") || "";
  const currentBinance = searchParams.get("binanceCompatible") || "";
  const currentSapVerified = searchParams.get("sapVerified") || "";
  const currentCovenant = searchParams.get("covenant") || "";
  const currentHatcher = searchParams.get("hatcher") || "";
  const currentMetaplex = searchParams.get("metaplex") || "";
  const currentMetaplexBound = searchParams.get("metaplexBoundToken") || "";
  const isHatcherDirectory = currentHatcher === "true";
  const currentSkills = searchParams.get("skills") || "";
  const currentMinScore = searchParams.get("minScore") || "";
  const currentMinFeedback = searchParams.get("minFeedback") || "";
  const currentActive = searchParams.get("active") || "";
  const currentArchetype = searchParams.get("archetype") || "";
  const currentAgentMode = searchParams.get("agentMode") || "";
  const currentSocialsList = parseSocialsQueryParam(searchParams.get("socials"));
  const searchScopeRaw = searchParams.get("searchScope") || "";
  const currentSearchScope: AgentsSearchScope =
    searchScopeRaw === "name" || searchScopeRaw === "description" || searchScopeRaw === "text"
      ? searchScopeRaw
      : "all";
  const filterCount = useMemo(
    () => countDirectoryActiveFilters(searchParams),
    [searchParams],
  );
  const timeWindow: DirectoryTimeWindow = useMemo(() => {
    if (currentActive === "24h") return "24h";
    if (currentActive === "7d") return "7d";
    if (currentActive === "30d") return "30d";
    if (currentActive === "live") return "live";
    return "all";
  }, [currentActive]);
  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v) params.set(k, v);
        else params.delete(k);
      });
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, searchParams, router],
  );
  useEffect(() => {
    if (searchParams.get("archetype") === "telegram") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("archetype");
      const qs = params.toString();
      router.replace(qs ? `/telegram?${qs}` : "/telegram");
    }
  }, [searchParams, router]);
  useEffect(() => {
    const urlQ = (searchParams.get("search") || "").trim();
    if (apiSearch === urlQ) return;
    updateParams({ search: apiSearch, page: "1" });
  }, [apiSearch, searchParams, updateParams]);
  const { data: chains } = useQuery<Array<{ chainId: number; name: string; isActive: boolean }>>({
    queryKey: ["networks"],
    queryFn: ({ signal }) => fetchJsonWithQuerySignal("/api/networks", signal),
    staleTime: 2 * 60 * 1000,
    retry: shouldRetryAgentsListQuery,
    retryDelay: agentsListRetryDelay,
  });
  const { data: ecosystemStats, isLoading: ecosystemStatsLoading } = useEcosystemStats();
  type DirectoryQueryData = DirectoryAgentListResponse & { newAgentIds: string[] };
  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<DirectoryQueryData>({
      queryKey: [
        "agent-directory",
        currentPage,
        currentSort,
        currentChain,
        currentService,
        apiSearch,
        currentPerPage,
        currentX402,
        currentHasWallet,
        currentVerified,
        currentXpay,
        currentBinance,
        currentSapVerified,
        currentCovenant,
        currentHatcher,
        currentMetaplex,
        currentMetaplexBound,
        currentSkills,
        currentMinScore,
        currentMinFeedback,
        currentActive,
        currentArchetype,
        currentAgentMode,
        currentSocialsList.join(","),
        currentSearchScope,
      ],
      refetchInterval: (q) =>
        agentDirectoryRefetchInterval({
          status: q.state.status,
          visible: isVisible,
          firstPage: currentPage === 1,
          hasFilters: filterCount > 0 || apiSearch.length > 0,
          agentCount: q.state.data?.agents.length ?? null,
          elapsedSinceMountMs:
            mountedAtMs.current == null ? 0 : Date.now() - mountedAtMs.current,
        }),
      refetchIntervalInBackground: false,
      staleTime: 45_000,
      retry: shouldRetryAgentsListQuery,
      retryDelay: agentsListRetryDelay,
      structuralSharing: (previous, next) => {
        const previousData = previous as DirectoryQueryData | undefined;
        const nextData = next as DirectoryQueryData;
        if (!previousData) return nextData;
        const previousIds = new Set(
          previousData.agents.map((agent) => `${agent.chainId}-${agent.agentId}`),
        );
        return {
          ...nextData,
          newAgentIds: nextData.agents
            .map((agent) => `${agent.chainId}-${agent.agentId}`)
            .filter((id) => !previousIds.has(id)),
        };
      },
      queryFn: async ({ signal }) => {
        const params = new URLSearchParams({
          page: String(currentPage),
          perPage: currentPerPage,
          sort: currentSort,
          listView: "true",
        });
        if (apiSearch) params.set("search", apiSearch);
        if (currentSearchScope !== "all") params.set("searchScope", currentSearchScope);
        if (currentChain) params.set("chain", currentChain);
        if (currentService) params.set("service", currentService);
        if (currentX402) params.set("x402", currentX402);
        if (currentHasWallet) params.set("hasWallet", currentHasWallet);
        if (currentVerified) params.set("verified", currentVerified);
        if (currentXpay) params.set("xpay", currentXpay);
        if (currentBinance) params.set("binanceCompatible", currentBinance);
        if (currentSapVerified) params.set("sapVerified", currentSapVerified);
        if (currentCovenant) params.set("covenant", currentCovenant);
        if (currentHatcher) params.set("hatcher", currentHatcher);
        if (currentMetaplex) params.set("metaplex", currentMetaplex);
        if (currentMetaplexBound) params.set("metaplexBoundToken", currentMetaplexBound);
        if (currentSkills) params.set("skills", currentSkills);
        if (currentMinScore) params.set("minScore", currentMinScore);
        if (currentMinFeedback) params.set("minFeedback", currentMinFeedback);
        if (currentActive) params.set("active", currentActive);
        if (currentArchetype) params.set("archetype", currentArchetype);
        if (currentAgentMode) params.set("agentMode", currentAgentMode);
        if (currentSocialsList.length > 0) params.set("socials", currentSocialsList.join(","));
        const r = await fetchWithQuerySignal(`/api/agents?${params}`, signal, 60_000);
        if (!r.ok) {
          const body = await r.text();
          throw new Error(body || `Failed to load agents (${r.status})`);
        }
        const result = (await r.json()) as DirectoryAgentListResponse;
        return { ...result, newAgentIds: [] };
      },
    });
  const newAgentIds = useMemo(() => new Set(data?.newAgentIds ?? []), [data?.newAgentIds]);
  const clearAllFilters = useCallback(() => {
    setSearch("");
    updateParams({
      chain: "",
      service: "",
      x402: "",
      hasWallet: "",
      verified: "",
      xpay: "",
      binanceCompatible: "",
      sapVerified: "",
      covenant: "",
      hatcher: "",
      metaplex: "",
      metaplexBoundToken: "",
      skills: "",
      minScore: "",
      minFeedback: "",
      active: "",
      archetype: "",
      agentMode: "",
      socials: "",
      search: "",
      searchScope: "",
      sort: "agent_rank_desc",
      page: "1",
    });
  }, [updateParams]);
  const setTimeWindow = useCallback(
    (window: DirectoryTimeWindow) => {
      const map: Record<DirectoryTimeWindow, string> = {
        "24h": "24h",
        "7d": "7d",
        "30d": "30d",
        live: "live",
        all: "",
      };
      updateParams({ active: map[window], page: "1", sort: window === "live" ? "listed_desc" : "" });
    },
    [updateParams],
  );
  return {
    search,
    setSearch,
    searchPending,
    searchHint: getAgentListSearchHint(search),
    filtersOpen,
    setFiltersOpen,
    view,
    setView,
    timeWindow,
    setTimeWindow,
    searchParams,
    updateParams,
    clearAllFilters,
    filterCount,
    chains: chains ?? [],
    ecosystemStats,
    ecosystemStatsLoading,
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
    isHatcherDirectory,
    newAgentIds,
    currentSort,
    currentPerPage,
    currentPage,
    currentSearchScope,
    currentChain,
    currentService,
    currentMinScore,
    currentMinFeedback,
    currentActive,
    currentArchetype,
    currentAgentMode,
    currentSocialsList,
    currentVerified,
    currentX402,
    currentHasWallet,
    currentSapVerified,
    currentCovenant,
    currentHatcher,
    currentBinance,
    currentSkills,
  };
}
