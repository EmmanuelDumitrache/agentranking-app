"use client";
import { ChevronDown, Loader2 } from "lucide-react";
import { AgentNewScannerRow } from "@/components/new-scanner/agent-new-scanner-row";
import { AgentNewScannerGridCard } from "@/components/new-scanner/agent-new-scanner-grid-card";
import { ScannerCardGrid, ScannerCardGridSkeleton } from "@/components/scanner/scanner-grid-card";
import { buildNewAgentScannerRow } from "@/lib/new-agent-scanner/row-model";
import type { NewAgentScannerAgent } from "@/lib/new-agent-scanner/types";
import type { ScannerTableLayout } from "@/lib/scanner-table-layout";
function SkeletonRows({ count = 8 }: { readonly count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={`sk-${i}`} className="new-scanner-table-row new-scanner-table-row--skeleton" aria-hidden>
          <td colSpan={4}>
            <div className="new-scanner-skeleton-bar" />
          </td>
        </tr>
      ))}
    </>
  );
}
export function AgentNewScannerTable({
  agents,
  layout = "single",
  isLoading,
  isError,
  errorMessage,
  loadingMore,
  hasMore,
  onLoadMore,
  newAgentKeys,
  catchUpStagger,
  startRank = 1,
}: {
  readonly agents: NewAgentScannerAgent[];
  readonly layout?: ScannerTableLayout;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage?: string;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
  readonly newAgentKeys: Set<string>;
  readonly catchUpStagger: Map<string, number>;
  readonly startRank?: number;
}) {
  const rows = agents.map((agent, idx) =>
    buildNewAgentScannerRow(agent, startRank + idx),
  );
  if (layout === "multi") {
    return (
      <div className="new-scanner-table-wrap">
        {isLoading ? (
          <div className="scanner-state">
            <div className="scanner-loading" role="status" aria-live="polite" aria-busy="true">
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              Loading agents
            </div>
            <ScannerCardGridSkeleton />
          </div>
        ) : null}
        {!isLoading && isError ? (
          <p className="new-scanner-state" role="alert">
            {errorMessage ?? "Failed to load agents."}
          </p>
        ) : null}
        {!isLoading && !isError && agents.length === 0 ? (
          <p className="new-scanner-state">No new agents yet.</p>
        ) : null}
        {!isLoading && !isError && rows.length > 0 ? (
          <ScannerCardGrid>
            {rows.map((row, idx) => {
              const agent = agents[idx]!;
              const agentKey = `${agent.chainId}-${agent.agentId}`;
              return (
                <AgentNewScannerGridCard
                  key={agentKey}
                  row={row}
                  isNew={newAgentKeys.has(agentKey)}
                  catchUpIndex={catchUpStagger.get(agentKey)}
                />
              );
            })}
          </ScannerCardGrid>
        ) : null}
        {loadingMore ? <ScannerCardGridSkeleton count={4} /> : null}
        {hasMore && !isLoading && !isError ? (
          <div className="new-scanner-load-more">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="new-scanner-load-more-btn"
            >
              {loadingMore ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              )}
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="new-scanner-table-wrap">
      <table className="new-scanner-table">
        <thead>
          <tr>
            <th scope="col" className="new-scanner-table-head new-scanner-table-head--launched">
              Launched
            </th>
            <th scope="col" className="new-scanner-table-head new-scanner-table-head--agent">
              Agent
            </th>
            <th scope="col" className="new-scanner-table-head new-scanner-table-head--chain">
              Chain
            </th>
            <th scope="col" className="new-scanner-table-head new-scanner-table-head--status">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? <SkeletonRows /> : null}
          {!isLoading && isError ? (
            <tr>
              <td colSpan={4} className="new-scanner-state" role="alert">
                {errorMessage ?? "Failed to load agents."}
              </td>
            </tr>
          ) : null}
          {!isLoading && !isError && agents.length === 0 ? (
            <tr>
              <td colSpan={4} className="new-scanner-state">
                No new agents yet.
              </td>
            </tr>
          ) : null}
          {!isLoading && !isError
            ? rows.map((row, idx) => {
                const agent = agents[idx]!;
                const agentKey = `${agent.chainId}-${agent.agentId}`;
                return (
                  <AgentNewScannerRow
                    key={agentKey}
                    row={row}
                    isNew={newAgentKeys.has(agentKey)}
                    catchUpIndex={catchUpStagger.get(agentKey)}
                  />
                );
              })
            : null}
          {loadingMore ? <SkeletonRows count={4} /> : null}
        </tbody>
      </table>
      {hasMore && !isLoading && !isError ? (
        <div className="new-scanner-load-more">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="new-scanner-load-more-btn"
          >
            {loadingMore ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}