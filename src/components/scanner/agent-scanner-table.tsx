"use client";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { agentProtocolLabel } from "@/lib/agent-rankable";
import {
  homeArScore,
  homeTrustDisplayLabel,
  type HomeDiscoveryAgent,
} from "@/lib/home-discovery-display";
import { cn } from "@/lib/utils";
import { HomeDiscoveryEmptyState } from "@/components/home/home-discovery-empty-state";
import type { MiniAgent } from "@/components/home/home-types";
import { buildScannerAgentRow } from "@/components/scanner/scanner-row-model";
import { ScannerMobileRow } from "@/components/scanner/scanner-mobile-row";
import { ScannerPagination } from "@/components/scanner/scanner-pagination";
import { ScannerRow } from "@/components/scanner/scanner-row";
import { ScannerCardGrid, ScannerCardGridSkeleton, ScannerGridCard } from "@/components/scanner/scanner-grid-card";
import { ScannerHeader } from "@/components/scanner/scanner-table-header";
import { ScannerLayoutToggle } from "@/components/scanner/scanner-layout-toggle";
import { useScannerLayoutContextOptional } from "@/components/scanner/scanner-layout-context";
import { scannerGridTemplate } from "@/components/scanner/scanner-grid";
import { useScannerTableLayout } from "@/hooks/use-scanner-table-layout";
import { SCANNER_LAYOUT_DEFAULT_DISCOVERY } from "@/lib/scanner-table-layout";
import type { ScannerTableLayout } from "@/lib/scanner-table-layout";
import type { ScannerSortColumn, ScannerViewMode } from "@/components/scanner/types";
function sortScannerAgents(
  agents: MiniAgent[],
  col: ScannerSortColumn | null,
  dir: "asc" | "desc",
): MiniAgent[] {
  if (!col) return agents;
  const sign = dir === "asc" ? 1 : -1;
  return [...agents].sort((a, b) => {
    switch (col) {
      case "name":
        return sign * a.name.localeCompare(b.name);
      case "chain":
        return sign * a.chain.shortName.localeCompare(b.chain.shortName);
      case "protocol":
        return sign * agentProtocolLabel(a).localeCompare(agentProtocolLabel(b));
      case "trust": {
        const ta = homeTrustDisplayLabel(a as HomeDiscoveryAgent);
        const tb = homeTrustDisplayLabel(b as HomeDiscoveryAgent);
        return sign * ta.localeCompare(tb);
      }
      case "reviews":
        return sign * ((a.totalFeedback ?? 0) - (b.totalFeedback ?? 0));
      case "ar":
        return sign * (homeArScore(a as HomeDiscoveryAgent) - homeArScore(b as HomeDiscoveryAgent));
      case "age": {
        const ta = new Date(a.listedAt ?? a.createdAt ?? 0).getTime();
        const tb = new Date(b.listedAt ?? b.createdAt ?? 0).getTime();
        return sign * (ta - tb);
      }
      default: {
        const _exhaustive: never = col;
        return _exhaustive;
      }
    }
  });
}
export type ScannerTablePaginationProps = {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isPageLoading?: boolean;
};
export interface AgentScannerTableProps {
  agents: MiniAgent[];
  mode?: ScannerViewMode;
  layoutDefault?: ScannerTableLayout;
  showLayoutToggle?: boolean;
  isLoading?: boolean;
  isPageLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  pagination?: ScannerTablePaginationProps;
  prevIds?: Set<number>;
  emptyTitle?: string;
  emptyDescription?: string;
  onResetFilters?: () => void;
  onClearChain?: () => void;
  showFilterEmptyActions?: boolean;
  /** Show sequential rank (#1, #2, …) for sorted directory views like /ranking. */
  usePageRank?: boolean;
}
export function AgentScannerTable({
  agents,
  mode = "full",
  layoutDefault = SCANNER_LAYOUT_DEFAULT_DISCOVERY,
  showLayoutToggle = true,
  isLoading,
  isPageLoading = false,
  isError,
  onRetry,
  pagination,
  prevIds,
  emptyTitle,
  emptyDescription,
  onResetFilters,
  onClearChain,
  showFilterEmptyActions = false,
  usePageRank = false,
}: Readonly<AgentScannerTableProps>) {
  const layoutCtx = useScannerLayoutContextOptional();
  const fallbackLayout = useScannerTableLayout(layoutDefault);
  const layout = layoutCtx?.layout ?? fallbackLayout.layout;
  const setLayout = layoutCtx?.setLayout ?? fallbackLayout.setLayout;
  const [sortCol, setSortCol] = useState<ScannerSortColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const handleSort = (col: ScannerSortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };
  const displayed = useMemo(() => {
    const sorted = sortScannerAgents(agents, sortCol, sortDir);
    const rankOffset =
      usePageRank && pagination
        ? (pagination.page - 1) * pagination.perPage
        : 0;
    return sorted.map((agent, index) => ({
      agent,
      row: buildScannerAgentRow(agent, {
        pageRank: usePageRank ? rankOffset + index + 1 : undefined,
      }),
    }));
  }, [agents, pagination, sortCol, sortDir, usePageRank]);
  const gridTemplate = scannerGridTemplate(mode);
  if (isError && agents.length === 0) {
    return (
      <div className="scanner-state py-10 text-center">
        <p className="text-[var(--ar-text-sm)] text-[var(--ar-text-tertiary)]">
          Could not load agents. Check your connection or try again.
        </p>
        {onRetry ? (
          <button type="button" className="ar-btn ar-btn-secondary mt-3" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (isLoading) {
    if (layout === "multi") {
      return (
        <div className="scanner-state">
          <div className="scanner-loading" role="status" aria-live="polite" aria-busy="true">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            Loading agents
          </div>
          <ScannerCardGridSkeleton />
        </div>
      );
    }
    return (
      <div className="scanner-state">
        <div className="scanner-loading" role="status" aria-live="polite" aria-busy="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading agents
        </div>
        <div className="scanner-skeleton hidden md:block" />
      </div>
    );
  }
  if (agents.length === 0) {
    return (
      <HomeDiscoveryEmptyState
        title={
          emptyTitle ??
          (showFilterEmptyActions ? "No agents match these filters" : "No agents found")
        }
        description={
          emptyDescription ??
          (showFilterEmptyActions
            ? "Try switching to All Chains or clearing type filters."
            : "No agents found.")}
        onReset={onResetFilters}
        onClearChain={onClearChain}
        showFilterActions={showFilterEmptyActions}
      />
    );
  }
  return (
    <div className={cn("scanner-table-host", isPageLoading && "scanner-table-host-loading")}>
      {showLayoutToggle && !layoutCtx ? (
        <div className="scanner-table-bar">
          <ScannerLayoutToggle layout={layout} onLayoutChange={setLayout} />
        </div>
      ) : null}
      {layout === "multi" ? (
        <ScannerCardGrid>
          {displayed.map(({ agent, row }) => (
            <ScannerGridCard
              key={agent.id}
              row={row}
              mode={mode}
              isNew={prevIds ? !prevIds.has(agent.id) : false}
            />
          ))}
        </ScannerCardGrid>
      ) : (
        <>
          <div className="scanner-mobile-list md:hidden">
            {displayed.map(({ agent, row }) => (
              <ScannerMobileRow
                key={agent.id}
                agent={agent}
                row={row}
                isNew={prevIds ? !prevIds.has(agent.id) : false}
                minimal={mode === "latest"}
              />
            ))}
          </div>
          <div
            className="scanner-table-scroll hidden md:block"
            data-layout={layout}
            data-mode={mode}
          >
            <div
              className="scanner-grid-shell"
              style={{ ["--scanner-grid-cols" as string]: gridTemplate }}
            >
              <ScannerHeader
                mode={mode}
                sortColumn={sortCol ?? undefined}
                sortDirection={sortDir}
                onSort={handleSort}
              />
              {displayed.map(({ agent, row }) => (
                <ScannerRow
                  key={agent.id}
                  row={row}
                  mode={mode}
                  layout={layout}
                  isNew={prevIds ? !prevIds.has(agent.id) : false}
                />
              ))}
            </div>
          </div>
        </>
      )}
      {pagination && pagination.total > 0 ? (
        <ScannerPagination
          page={pagination.page}
          perPage={pagination.perPage}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={pagination.onPageChange}
          isPageLoading={isPageLoading || pagination.isPageLoading}
        />
      ) : null}
    </div>
  );
}