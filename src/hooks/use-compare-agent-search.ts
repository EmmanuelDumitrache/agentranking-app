"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { computeAgentSearchRelevanceAgent } from "@/lib/agents-search-relevance";
import {
  getAgentListSearchHint,
  resolveAgentListSearchForApi,
} from "@/lib/agents-search-scope";
import type { CompareAgent } from "@/lib/compare-agent";
import { useDebounce } from "@/hooks/use-debounce";
type CompareSearchResponse = {
  agents: CompareAgent[];
};
export function useCompareAgentSearch(rawQuery: string) {
  const debouncedQuery = useDebounce(rawQuery.trim(), 200);
  const apiSearch = resolveAgentListSearchForApi(debouncedQuery);
  const queryReady = apiSearch.length > 0;
  const { data, isLoading, isFetching, isError, error, isFetched } = useQuery({
    queryKey: ["compare-search", apiSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        search: apiSearch,
        perPage: "16",
        sort: "profile_desc",
        listView: "true",
        compare: "1",
      });
      const res = await fetch(`/api/agents?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Search failed (${res.status})`);
      }
      return res.json() as Promise<CompareSearchResponse>;
    },
    enabled: queryReady,
    staleTime: 30_000,
  });
  const agents = useMemo(() => {
    const rows = data?.agents ?? [];
    if (!debouncedQuery) return rows;
    return [...rows].sort((a, b) => {
      const ra = computeAgentSearchRelevanceAgent(
        { name: a.name, description: a.description },
        debouncedQuery,
      );
      const rb = computeAgentSearchRelevanceAgent(
        { name: b.name, description: b.description },
        debouncedQuery,
      );
      if (rb !== ra) return rb - ra;
      const aRank = a.isPremiumVerified ? 2 : a.isVerified ? 1 : 0;
      const bRank = b.isPremiumVerified ? 2 : b.isVerified ? 1 : 0;
      if (aRank !== bRank) return bRank - aRank;
      return (b.agentRankScore ?? 0) - (a.agentRankScore ?? 0);
    });
  }, [data?.agents, debouncedQuery]);
  return {
    agents,
    debouncedQuery,
    apiSearch,
    queryReady,
    hint: getAgentListSearchHint(rawQuery),
    isLoading: queryReady && (isLoading || isFetching),
    isFetched: queryReady && isFetched,
    isError,
    error: error instanceof Error ? error.message : isError ? "Search failed" : null,
  };
}
