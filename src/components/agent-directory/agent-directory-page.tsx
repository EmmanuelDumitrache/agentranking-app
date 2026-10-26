"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { AgentDirectorySearchBar } from "@/components/agent-directory/agent-directory-search-bar";
import { AgentDirectoryStats } from "@/components/agent-directory/agent-directory-stats";
import { AgentAdvancedFiltersDrawer } from "@/components/agent-directory/agent-advanced-filters-drawer";
import { HatcherAgentsDirectoryTable } from "@/components/hatcher/hatcher-agents-directory-table";
import { AgentScannerTable } from "@/components/scanner/agent-scanner-table";
import { ScannerLayoutProvider } from "@/components/scanner/scanner-layout-context";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import { SCANNER_LAYOUT_DEFAULT_DISCOVERY } from "@/lib/scanner-table-layout";
import { useAgentDirectory } from "@/hooks/use-agent-directory";
import { draftFromSearchParams, DIRECTORY_FILTER_PARAM_KEYS } from "@/lib/agent-directory/filters";
import { directoryAgentToMiniAgent } from "@/lib/agent-directory/to-scanner-agent";
function AgentDirectoryPageContent() {
  const dir = useAgentDirectory();
  const [filterDraft, setFilterDraft] = useState<Record<string, string>>({});
  const openFilters = () => {
    setFilterDraft(draftFromSearchParams(dir.searchParams));
    dir.setFiltersOpen(true);
  };
  const applyFilters = () => {
    const updates: Record<string, string> = { page: "1" };
    for (const key of DIRECTORY_FILTER_PARAM_KEYS) {
      updates[key] = filterDraft[key] ?? "";
    }
    updates.sort = filterDraft.sort || "agent_rank_desc";
    dir.updateParams(updates);
    dir.setFiltersOpen(false);
  };
  const agents = useMemo(() => dir.data?.agents ?? [], [dir.data?.agents]);
  const scannerAgents = useMemo(() => agents.map(directoryAgentToMiniAgent), [agents]);
  const newAgentDbIds = useMemo(() => {
    if (agents.length === 0 || dir.newAgentIds.size === 0) return undefined;
    return new Set(
      agents
        .filter((a) => dir.newAgentIds.has(`${a.chainId}-${a.agentId}`))
        .map((a) => a.id),
    );
  }, [agents, dir.newAgentIds]);
  const total = dir.data?.total ?? 0;
  const page = dir.data?.page ?? dir.currentPage;
  const perPage = dir.data?.perPage ?? Number(dir.currentPerPage);
  const totalPages = dir.data?.totalPages ?? 1;
  return (
    <ScannerLayoutProvider defaultLayout={SCANNER_LAYOUT_DEFAULT_DISCOVERY}>
      <div className="ui-page-stack min-w-0 space-y-4 overflow-x-hidden">
        <AgentDirectoryStats
          stats={dir.ecosystemStats}
          timeWindow={dir.timeWindow}
          onTimeWindowChange={dir.setTimeWindow}
          isLoading={dir.ecosystemStatsLoading}
          isRefreshing={dir.isLoading || dir.isFetching}
          onRefresh={() => void dir.refetch()}
          listedAgents={dir.data?.total ?? null}
          hasActiveDirectoryFilters={
            dir.filterCount > 0 || dir.search.trim().length > 0 || dir.timeWindow !== "all"
          }
        />
        <AgentDirectorySearchBar
          search={dir.search}
          onSearchChange={dir.setSearch}
          filterCount={dir.filterCount}
          onOpenFilters={openFilters}
        />
        {dir.searchPending ? (
          <p className="text-muted-foreground py-1 text-center text-sm">{dir.searchHint}</p>
        ) : null}
        {dir.data?.protocolTrustSort?.capped ? (
          <p className="text-muted-foreground/70 py-1 text-[11px]">
            Trust sort ranks up to {dir.data.protocolTrustSort.poolSize.toLocaleString()} agents out of{" "}
            {dir.data.protocolTrustSort.fullMatchCount.toLocaleString()} matches. Narrow filters for full ranking.
          </p>
        ) : null}
        <PublicSitePanel className="gap-0 overflow-hidden p-0 [&_.scanner-grid-header]:border-b [&_.scanner-grid-header]:border-border/40 [&_.scanner-grid-row]:border-b [&_.scanner-grid-row]:border-border/20 [&_.scanner-grid-row:last-child]:border-b-0 [&_.scanner-grid-row:hover]:bg-foreground/[0.03] [&_.scanner-grid-header-cell]:text-xs [&_.scanner-grid-header-cell]:font-medium [&_.scanner-grid-header-cell]:text-muted-foreground [&_.scanner-pagination]:border-t [&_.scanner-pagination]:border-border/40 [&_.scanner-mobile-row]:border-b [&_.scanner-mobile-row]:border-border/20 [&_.scanner-mobile-row:last-child]:border-b-0">
          {dir.isHatcherDirectory ? (
            <HatcherAgentsDirectoryTable agents={agents} />
          ) : (
            <AgentScannerTable
              agents={scannerAgents}
              mode="full"
              usePageRank
              isLoading={dir.isLoading}
              isPageLoading={dir.isFetching}
              isError={dir.isError}
              onRetry={() => void dir.refetch()}
              prevIds={newAgentDbIds}
              showFilterEmptyActions
              emptyTitle="No agents match these filters"
              emptyDescription="Try clearing filters or switching to All chains."
              onResetFilters={dir.clearAllFilters}
              onClearChain={() => dir.updateParams({ chain: "", page: "1" })}
              pagination={{
                page,
                perPage,
                total,
                totalPages,
                onPageChange: (p) => dir.updateParams({ page: String(p) }),
                isPageLoading: dir.isFetching,
              }}
            />
          )}
        </PublicSitePanel>
        <AgentAdvancedFiltersDrawer
          open={dir.filtersOpen}
          onOpenChange={dir.setFiltersOpen}
          chains={dir.chains}
          draft={filterDraft}
          onDraftChange={(key: string, value: string) => setFilterDraft((d) => ({ ...d, [key]: value }))}
          onDraftReplace={setFilterDraft}
          onApply={applyFilters}
          onClear={() => {
            dir.clearAllFilters();
            dir.setFiltersOpen(false);
          }}
        />
        <div className="mt-1 border-t border-border/40 pt-3">
          <p className="text-muted-foreground/60 text-center text-[11px]">
            Looking for AgentRanking-created agents?{" "}
            <Link href="/agents" className="text-muted-foreground underline hover:text-foreground">
              Browse Agents
            </Link>
          </p>
        </div>
      </div>
    </ScannerLayoutProvider>
  );
}
export function AgentDirectoryPage() {
  return (
    <Suspense
      fallback={
        <div className="ui-page-stack min-w-0 space-y-4" aria-busy="true">
          <div className="h-16 animate-pulse rounded-lg border border-border/40 bg-muted/20" />
          <div className="h-10 animate-pulse rounded-lg border border-border/40 bg-muted/20" />
          <div className="h-28 animate-pulse rounded-lg border border-border/40 bg-muted/20" />
        </div>
      }
    >
      <AgentDirectoryPageContent />
    </Suspense>
  );
}
