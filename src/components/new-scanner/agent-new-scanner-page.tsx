"use client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AgentNewScannerTable } from "@/components/new-scanner/agent-new-scanner-table";
import { AgentNewScannerToolbar } from "@/components/new-scanner/agent-new-scanner-toolbar";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { ScannerLayoutProvider, useScannerLayoutContext } from "@/components/scanner/scanner-layout-context";
import { SCANNER_LAYOUT_DEFAULT_DISCOVERY } from "@/lib/scanner-table-layout";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { agentsListRetryDelay, shouldRetryAgentsListQuery } from "@/lib/agents-query-retry";
import {
  NEW_SCANNER_CATCHUP_HIGHLIGHT_MS,
  NEW_SCANNER_PER_PAGE,
  NEW_SCANNER_POLL_HIDDEN_MS,
  NEW_SCANNER_POLL_VISIBLE_MS,
} from "@/lib/new-agent-scanner/constants";
import {
  agentListingKey,
  computeMissedAgentKeys,
  readNewScannerSeenKeys,
  writeNewScannerSeenKeys,
} from "@/lib/new-agent-scanner/seen-keys";
import type { NewAgentScannerAgent } from "@/lib/new-agent-scanner/types";
import { fetchWithQuerySignal, fetchWithTimeout } from "@/lib/fetch-with-query-signal";
import type { NewAgentScannerPageData } from "@/lib/new-agent-scanner/data";
interface AgentData {
  agents: NewAgentScannerAgent[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  nextCursor: string | null;
}
export function AgentNewScannerPage({
  initialData,
}: {
  readonly initialData?: NewAgentScannerPageData;
}) {
  const isVisible = usePageVisibility();
  const [loadedAgents, setLoadedAgents] = useState<NewAgentScannerAgent[]>(initialData?.agents ?? []);
  const [currentPage, setCurrentPage] = useState(initialData?.page ?? 1);
  const [, setTotalPages] = useState(initialData?.totalPages ?? 1);
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newAgentKeys, setNewAgentKeys] = useState<Set<string>>(new Set());
  const [catchUpStagger, setCatchUpStagger] = useState<Map<string, number>>(new Map());
  const [initialSeenKeys] = useState(readNewScannerSeenKeys);
  const prevAgentKeys = useRef<Set<string>>(initialSeenKeys);
  const scrollToTopOnCatchUp = useRef(initialSeenKeys.size > 0);
  const scrollPosRef = useRef(0);
  const prevVisible = useRef(isVisible);
  const prevDataUpdatedAt = useRef<number | null>(null);
  useEffect(() => {
    if (newAgentKeys.size === 0) return;
    const timer = window.setTimeout(() => {
      setNewAgentKeys(new Set());
      setCatchUpStagger(new Map());
    }, NEW_SCANNER_CATCHUP_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [newAgentKeys]);
  useEffect(() => {
    const onScroll = () => {
      scrollPosRef.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const fetchPage = useCallback(
    async (page: number, options?: { signal?: AbortSignal; cursor?: string | null }): Promise<AgentData> => {
      const params = new URLSearchParams({
        page: String(page),
        perPage: String(NEW_SCANNER_PER_PAGE),
      });
      if (options?.cursor) params.set("cursor", options.cursor);
      const url = `/api/agents/new?${params}`;
      const r = options?.signal
        ? await fetchWithQuerySignal(url, options.signal, 60_000)
        : await fetchWithTimeout(url, 60_000);
      if (!r.ok) {
        const body = await r.text();
        throw new Error(body || `Failed to load agents (${r.status})`);
      }
      return r.json();
    },
    [],
  );
  const { isLoading, isError, error, dataUpdatedAt, refetch, isFetching } = useQuery<AgentData>({
    queryKey: ["new-scanner-agents"],
    refetchInterval: (q) =>
      q.state.status === "error" ? false : isVisible ? NEW_SCANNER_POLL_VISIBLE_MS : NEW_SCANNER_POLL_HIDDEN_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    initialData,
    retry: shouldRetryAgentsListQuery,
    retryDelay: agentsListRetryDelay,
    queryFn: async ({ signal }) => {
      const data = await fetchPage(1, { signal });
      const currentKeys = new Set(data.agents.map((a) => agentListingKey(a.chainId, a.agentId)));
      if (prevAgentKeys.current.size > 0) {
        const { missedKeys, staggerByKey } = computeMissedAgentKeys(data.agents, prevAgentKeys.current);
        if (missedKeys.length > 0) {
          setNewAgentKeys(new Set(missedKeys));
          setCatchUpStagger(staggerByKey);
          if (scrollToTopOnCatchUp.current) {
            scrollToTopOnCatchUp.current = false;
            requestAnimationFrame(() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
            });
          }
        }
      }
      prevAgentKeys.current = currentKeys;
      writeNewScannerSeenKeys(currentKeys);
      setLoadedAgents(data.agents);
      setCurrentPage(1);
      setTotalPages(data.totalPages);
      setNextCursor(data.nextCursor);
      return data;
    },
  });
  useEffect(() => {
    if (isVisible && !prevVisible.current) {
      scrollToTopOnCatchUp.current = true;
      void refetch();
    }
    prevVisible.current = isVisible;
  }, [isVisible, refetch]);
  useLayoutEffect(() => {
    if (dataUpdatedAt == null) return;
    const saved = scrollPosRef.current;
    const current = window.scrollY;
    if (saved > 80 && current < 50 && prevDataUpdatedAt.current !== dataUpdatedAt) {
      window.scrollTo({ top: saved, behavior: "auto" });
    }
    prevDataUpdatedAt.current = dataUpdatedAt;
  }, [dataUpdatedAt]);
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const next = currentPage + 1;
      const data = await fetchPage(next, { cursor: nextCursor });
      setLoadedAgents((prev) => [...prev, ...data.agents]);
      setCurrentPage(next);
      setTotalPages(data.totalPages);
      setNextCursor(data.nextCursor);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, currentPage, fetchPage]);
  const hasMore = nextCursor !== null;
  return (
    <PublicSitePageShell fullBleed className="new-scanner-page">
      <ScannerLayoutProvider defaultLayout={SCANNER_LAYOUT_DEFAULT_DISCOVERY}>
        <AgentNewScannerPageBody
          loadedAgents={loadedAgents}
          isLoading={isLoading}
          isError={isError}
          error={error}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadMore={() => void handleLoadMore()}
          newAgentKeys={newAgentKeys}
          catchUpStagger={catchUpStagger}
          onRefresh={() => void refetch()}
          isFetching={isFetching}
        />
      </ScannerLayoutProvider>
    </PublicSitePageShell>
  );
}
function AgentNewScannerPageBody({
  loadedAgents,
  isLoading,
  isError,
  error,
  loadingMore,
  hasMore,
  onLoadMore,
  newAgentKeys,
  catchUpStagger,
  onRefresh,
  isFetching,
}: {
  readonly loadedAgents: NewAgentScannerAgent[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
  readonly newAgentKeys: Set<string>;
  readonly catchUpStagger: Map<string, number>;
  readonly onRefresh: () => void;
  readonly isFetching: boolean;
}) {
  const { layout } = useScannerLayoutContext();
  return (
    <div className="new-scanner-panel">
      <AgentNewScannerToolbar
        isRefreshing={isLoading || isFetching}
        onRefresh={onRefresh}
      />
      <AgentNewScannerTable
        agents={loadedAgents}
        layout={layout}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        newAgentKeys={newAgentKeys}
        catchUpStagger={catchUpStagger}
      />
    </div>
  );
}
