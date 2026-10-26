import { RuntimeImage } from "@/components/shared/runtime-image";
import { ChevronLeft, ChevronRight, Eye, TrendingUp, Users } from "lucide-react";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import {
  DASHBOARD_RANKINGS_PAGE_SIZE,
  loadDashboardRankings,
} from "@/lib/dashboard/analytics-rankings.server";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ agentDbId: string }>;
  searchParams: Promise<{ page?: string; scope?: string }>;
};
function Sparkline({ data }: { data: { date: string; views: number }[] }) {
  const max = Math.max(...data.map((d) => d.views), 1);
  return (
    <div className="flex items-end gap-px h-10">
      {data.map((d) => (
        <div
          key={d.date}
          className="flex-1 rounded-t-sm"
          style={{
            height: `${Math.max(2, (d.views / max) * 100)}%`,
            backgroundColor: d.views > 0
              ? "color-mix(in oklab, currentColor 35%, transparent)"
              : "var(--app-border)",
          }}
        />
      ))}
    </div>
  );
}
function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
function RankMedal({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <span className="inline-flex items-center justify-center w-5 text-xs font-bold shrink-0">
        {rank === 1 ? "\u{1F947}" : rank === 2 ? "\u{1F948}" : "\u{1F949}"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-5 tabular-nums font-mono text-xs text-muted-foreground shrink-0">
      {rank}
    </span>
  );
}
function PageButton({
  children,
  disabled,
  page,
  current,
  scope,
  ...rest
}: {
  children: React.ReactNode;
  disabled?: boolean;
  page?: number;
  current: number;
  scope: "mine" | "all";
} & React.ComponentPropsWithoutRef<"a">) {
  const isActive = page !== undefined && page === current;
  if (disabled) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/30 cursor-not-allowed" aria-disabled>
        {children}
      </span>
    );
  }
  const href = page !== undefined ? `?scope=${scope}&page=${page}` : "#";
  return (
    <a
      href={href}
      className={
        isActive
          ? "inline-flex h-7 w-7 items-center justify-center rounded bg-muted text-sm font-medium tabular-nums"
          : "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground text-sm font-medium tabular-nums"
      }
      aria-current={isActive ? "page" : undefined}
      {...rest}
    >
      {children}
    </a>
  );
}
export default async function DashboardRankingsRoute({ params, searchParams }: Props) {
  const { agentDbId } = await params;
  const { page: pageStr, scope: scopeStr } = await searchParams;
  const id = Number.parseInt(agentDbId, 10);
  const { ownedAgents, agent } = await requireDashboardAgentPage(id);
  const ownedAgentIds = ownedAgents.map((ownedAgent) => ownedAgent.id);
  const rankings = await loadDashboardRankings(id, pageStr, {
    ownedAgentIds,
    scope: scopeStr,
  });
  const ownedAgentIdSet = new Set(ownedAgentIds);
  const {
    agents: pageAgents,
    totalCount,
    totalPages,
    currentPage,
    averageAgentRankScore,
    verifiedCount,
    viewStats,
    scope,
  } = rankings;
  const start = (currentPage - 1) * DASHBOARD_RANKINGS_PAGE_SIZE;
  const scopeToggle = (
    <div className="inline-flex rounded-full border border-border/60 bg-muted/20 p-0.5 text-xs">
      <a
        href="?scope=mine&page=1"
        className={
          scope === "mine"
            ? "rounded-full bg-muted px-3 py-1.5 font-medium text-foreground"
            : "rounded-full px-3 py-1.5 text-muted-foreground hover:text-foreground"
        }
      >
        Your agents
      </a>
      <a
        href="?scope=all&page=1"
        className={
          scope === "all"
            ? "rounded-full bg-muted px-3 py-1.5 font-medium text-foreground"
            : "rounded-full px-3 py-1.5 text-muted-foreground hover:text-foreground"
        }
      >
        All agents
      </a>
    </div>
  );
  if (totalCount === 0) {
    return (
      <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
        <div className="ui-overview-summary overflow-hidden rounded-xl">
          <div className="ui-overview-identity flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Agent Rankings</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Compare visibility and AgentRank performance.
              </p>
            </div>
            {scopeToggle}
          </div>
        </div>
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">
              {scope === "mine" ? "Your agents" : "Rankings"}
            </h2>
          </div>
          <div className="px-5 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {scope === "mine" ? "You don’t have ranked agents yet" : "No ranked agents yet"}
            </p>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Agent Rankings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare visibility and AgentRank performance.
            </p>
          </div>
          {scopeToggle}
        </div>
        <div className="ui-overview-metrics grid sm:grid-cols-3">
        <div className="ui-overview-metric p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">YOUR VIEWS</p>
          </div>
          <p className="text-xl font-semibold tabular-nums">{formatViews(viewStats.totalViews)}</p>
          <p className="text-[11px] text-muted-foreground">Total profile views for {agent.name}</p>
        </div>
        <div className="ui-overview-metric p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              {scope === "mine" ? "YOUR AGENTS" : "ALL AGENTS"}
            </p>
          </div>
          <p className="text-xl font-semibold tabular-nums">{totalCount}</p>
          <p className="text-[11px] text-muted-foreground">
            {verifiedCount} verified &middot; avg AR {averageAgentRankScore}
          </p>
        </div>
        <div className="ui-overview-metric p-4 space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">DAILY TREND</p>
          </div>
          <Sparkline data={viewStats.daily} />
          <p className="text-[11px] text-muted-foreground">{agent.name} &middot; last 30 days</p>
        </div>
      </div>
      </div>
      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">
            {scope === "mine" ? "Your ranked agents" : "Ranked agents"}
          </h2>
        </div>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/60">
              <th className="py-2.5 pl-4 pr-1 text-left text-[11px] font-medium text-muted-foreground w-8">
                #
              </th>
              <th className="py-2.5 px-1 text-left text-[11px] font-medium text-muted-foreground">
                Agent
              </th>
              <th className="py-2.5 pl-1 pr-4 text-right text-[11px] font-medium text-muted-foreground w-20">
                AR Score
              </th>
            </tr>
          </thead>
          <tbody>
            {pageAgents.map((agent, i) => {
              const rank = start + i + 1;
              const isOwned = ownedAgentIdSet.has(agent.id);
              return (
                <tr
                  key={agent.id}
                  className={
                    isOwned
                      ? "border-b border-border/60 bg-muted/30"
                      : "border-b border-border/60"
                  }
                >
                  <td className="py-2 pl-4 pr-1 align-middle">
                    <RankMedal rank={rank} />
                  </td>
                  <td className="py-2 px-1 align-middle">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md bg-muted/40">
                        {agent.image ? (
                          <RuntimeImage
                            src={agent.image}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] font-bold text-muted-foreground uppercase">
                            {agent.name.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{agent.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {agent.chain.shortName}
                          {agent.isPremiumVerified && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-400">
                              PRO
                            </span>
                          )}
                          {agent.isVerified && !agent.isPremiumVerified && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                              Verified
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pl-1 pr-4 text-right tabular-nums align-middle">
                    <span className="text-sm font-medium tabular-nums">
                      {agent.agentRankScore.toLocaleString()}
                    </span>
                    {isOwned && (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-400">
                        Yours
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile list */}
      <div className="divide-y divide-border/60 overflow-hidden sm:hidden">
        {pageAgents.map((agent, i) => {
          const rank = start + i + 1;
          const isOwned = ownedAgentIdSet.has(agent.id);
          return (
            <div
              key={agent.id}
              className={
                isOwned
                  ? "flex items-center gap-3 px-4 py-2.5 bg-muted/30"
                  : "flex items-center gap-3 px-4 py-2.5"
              }
            >
              <RankMedal rank={rank} />
              <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                {agent.image ? (
                  <RuntimeImage
                    src={agent.image}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[9px] font-bold text-muted-foreground uppercase">
                    {agent.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {agent.name}
                  {isOwned && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-400">
                      Yours
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {agent.chain.shortName}
                  {agent.isPremiumVerified && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-400">
                      PRO
                    </span>
                  )}
                  {agent.isVerified && !agent.isPremiumVerified && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                      Verified
                    </span>
                  )}
                </p>
              </div>
              <span className="text-sm font-medium tabular-nums shrink-0">
                {agent.agentRankScore.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
      </section>
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          <PageButton disabled={currentPage <= 1} page={currentPage - 1} current={currentPage} scope={scope} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </PageButton>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            let p: number;
            if (totalPages <= 5) {
              p = i + 1;
            } else if (currentPage <= 3) {
              p = i + 1;
            } else if (currentPage >= totalPages - 2) {
              p = totalPages - 4 + i;
            } else {
              p = currentPage - 2 + i;
            }
            return (
              <PageButton key={p} page={p} current={currentPage} scope={scope}>
                {p}
              </PageButton>
            );
          })}
          <PageButton disabled={currentPage >= totalPages} page={currentPage + 1} current={currentPage} scope={scope} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </PageButton>
        </div>
      )}
    </div>
  );
}
