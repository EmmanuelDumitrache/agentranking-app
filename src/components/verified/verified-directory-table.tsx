"use client";
import { ChevronDown, Loader2, AlertTriangle } from "lucide-react";
import { VerifiedDirectoryRow } from "@/components/verified/verified-directory-row";
import { VerifiedDirectoryGridCard } from "@/components/verified/verified-directory-grid-card";
import { VerifiedDirectoryLayoutToggle } from "@/components/verified/verified-directory-layout-toggle";
import type { VerifiedAgentRow } from "@/components/verified/types";
import { useVerifiedDirectoryLayout } from "@/hooks/use-verified-directory-layout";
import {
  VERIFIED_DIRECTORY_SUBCOPY,
  VERIFIED_DIRECTORY_TITLE,
} from "@/lib/verified-page-config";
export function VerifiedDirectoryTable({
  agents,
  total,
  loading,
  loadingMore,
  error,
  hasMore,
  onRetry,
  onLoadMore,
}: {
  readonly agents: VerifiedAgentRow[];
  readonly total: number;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const { layout, setLayout } = useVerifiedDirectoryLayout();
  const sortedAgents = [...agents].sort(
    (a, b) => Number(b.isPremiumVerified) - Number(a.isPremiumVerified),
  );
  return (
    <section id="verified-directory" className="verified-directory scroll-mt-20">
      <header className="verified-directory-header">
        <div>
          <h2 className="verified-section-title">{VERIFIED_DIRECTORY_TITLE}</h2>
          <p className="verified-directory-subcopy">{VERIFIED_DIRECTORY_SUBCOPY}</p>
        </div>
        {!loading && !error && agents.length > 0 ? (
          <div className="verified-directory-header-tools">
            <VerifiedDirectoryLayoutToggle layout={layout} onLayoutChange={setLayout} />
            <span className="verified-directory-count">{total.toLocaleString()} agents</span>
          </div>
        ) : null}
      </header>
      {loading ? (
        <div className="verified-directory-state" role="status" aria-busy="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading…
        </div>
      ) : null}
      {error ? (
        <div className="verified-directory-error" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" onClick={onRetry} className="verified-directory-retry">
            Retry
          </button>
        </div>
      ) : null}
      {!loading && !error && agents.length === 0 ? (
        <div className="verified-directory-state">No verified agents yet.</div>
      ) : null}
      {!loading && !error && agents.length > 0 ? (
        <>
          {layout === "grid" ? (
            <div className="verified-directory-grid">
              {sortedAgents.map((agent, idx) => (
                <VerifiedDirectoryGridCard key={agent.id} agent={agent} rank={idx + 1} />
              ))}
            </div>
          ) : (
            <div className="verified-directory-table-wrap">
              <div className="verified-directory-table-scroll">
                <table className="verified-directory-table">
                  <colgroup>
                    <col className="verified-directory-col verified-directory-col--rank" />
                    <col className="verified-directory-col verified-directory-col--agent" />
                    <col className="verified-directory-col verified-directory-col--chain" />
                    <col className="verified-directory-col verified-directory-col--num" />
                    <col className="verified-directory-col verified-directory-col--num" />
                    <col className="verified-directory-col verified-directory-col--num" />
                    <col className="verified-directory-col verified-directory-col--status" />
                    <col className="verified-directory-col verified-directory-col--status" />
                    <col className="verified-directory-col verified-directory-col--meta" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col" className="verified-directory-th verified-directory-th--rank">
                        #
                      </th>
                      <th scope="col" className="verified-directory-th verified-directory-th--agent">
                        Agent
                      </th>
                      <th scope="col" className="verified-directory-th verified-directory-th--chain">
                        Chain
                      </th>
                      <th scope="col" className="verified-directory-th verified-directory-th--num">
                        AR
                      </th>
                      <th scope="col" className="verified-directory-th verified-directory-th--num">
                        Services
                      </th>
                      <th scope="col" className="verified-directory-th verified-directory-th--num">
                        MCP
                      </th>
                      <th scope="col" className="verified-directory-th verified-directory-th--status">
                        x402
                      </th>
                      <th scope="col" className="verified-directory-th verified-directory-th--status">
                        DevProof
                      </th>
                      <th scope="col" className="verified-directory-th verified-directory-th--meta">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAgents.map((agent, idx) => (
                      <VerifiedDirectoryRow key={agent.id} agent={agent} rank={idx + 1} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {hasMore ? (
            <div className="verified-directory-load-more">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="verified-directory-load-more-btn"
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
      ) : null}
    </section>
  );
}