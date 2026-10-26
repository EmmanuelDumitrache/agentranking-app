"use client";
import { useMemo, useState, type ReactNode } from "react";
import { AgentMarketCard } from "@/components/public-site/agent-market-card";
import { AgentsShareButton } from "@/components/public-site/agents-share-button";
import {
  PublicAgentsBrowseToolbar,
} from "@/components/public-site/public-agents-browse-toolbar";
import type { PublicAgentSortKey } from "@/lib/public-site/agent-browse-filters";
import {
  PublicSiteEmptyState,
  PublicSitePanel,
} from "@/components/public-site/public-site-ui";
import type { PublicAgentIndexModel } from "@/lib/public-agents-index.server";
import type { AgentsShareDayPoint } from "@/lib/public-site/agents-share-card";
import {
  compareByAgentSort,
  computeAgentSearchRelevance,
} from "@/lib/public-site/agent-browse-filters";
import { getPublicAgentVerificationStatus } from "@/lib/public-site/agent-verification";
import { useArLiveFeedRefresh } from "@/hooks/use-ar-live-feed-refresh";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { cn } from "@/lib/utils";
const PAGE_SIZE = 60;
type Props = {
  readonly agents: readonly PublicAgentIndexModel[];
  readonly initialSort?: PublicAgentSortKey;
};
function agentListedAt(agent: PublicAgentIndexModel): string | null {
  return agent.launchCreatedAt ?? agent.listedAt;
}
function toSortable(agent: PublicAgentIndexModel) {
  return {
    agentRankScore: agent.agentRankScore,
    listedAt: agentListedAt(agent),
    lastActiveAt: agent.lastActiveAt,
    isVerified: getPublicAgentVerificationStatus(agent).isVerified,
    isTokenized: Boolean(agent.linkedToken),
  };
}
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function buildAgentDaySeries(
  agents: readonly PublicAgentIndexModel[],
  days: number,
): AgentsShareDayPoint[] {
  const now = new Date();
  const series: AgentsShareDayPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    series.push({
      key: dayKey(date),
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      count: 0,
      tokenized: 0,
      verified: 0,
    });
  }
  const indexes = new Map(series.map((point, index) => [point.key, index]));
  for (const agent of agents) {
    const rawDate = agent.listedAt ?? agent.launchCreatedAt;
    if (!rawDate) continue;
    const date = new Date(rawDate);
    if (!Number.isFinite(date.getTime())) continue;
    const index = indexes.get(dayKey(date));
    if (index == null) continue;
    const point = series[index];
    if (!point) continue;
    series[index] = {
      ...point,
      count: point.count + 1,
      tokenized: point.tokenized + (agent.linkedToken ? 1 : 0),
      verified: point.verified + (getPublicAgentVerificationStatus(agent).isVerified ? 1 : 0),
    };
  }
  return series;
}
function StatValue({ children }: { readonly children: ReactNode }) {
  return (
    <p className="mt-1.5 bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-[1.75rem] font-semibold leading-none tracking-tight text-transparent tabular-nums sm:text-[2rem]">
      {children}
    </p>
  );
}
function DayBars({
  series,
  selectedKey,
  onSelect,
}: {
  readonly series: readonly AgentsShareDayPoint[];
  readonly selectedKey: string;
  readonly onSelect: (key: string) => void;
}) {
  const max = Math.max(1, ...series.map((point) => point.count));
  return (
    <fieldset className="m-0 mt-2 flex h-10 min-w-0 items-stretch gap-1 border-0 p-0">
      <legend className="sr-only">New agents by day</legend>
      {series.map((point) => {
        const selected = point.key === selectedKey;
        const heightPct = Math.max(point.count > 0 ? 18 : 8, (point.count / max) * 100);
        return (
          <button
            key={point.key}
            type="button"
            onClick={() => onSelect(point.key)}
            className="group flex min-w-0 flex-1 flex-col items-center justify-end outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-pressed={selected}
            aria-label={`${point.label}: ${point.count} new agent${point.count === 1 ? "" : "s"}`}
            title={`${point.label} · ${point.count}`}
          >
            <span
              className={cn(
                "w-full max-w-[14px] rounded-sm transition-colors",
                selected
                  ? "bg-foreground"
                  : "bg-muted-foreground/35 group-hover:bg-muted-foreground/55",
              )}
              style={{ height: `${heightPct}%`, minHeight: 4 }}
            />
          </button>
        );
      })}
    </fieldset>
  );
}
function AgentStats({ agents }: Pick<Props, "agents">) {
  const series = useMemo(() => buildAgentDaySeries(agents, 7), [agents]);
  const todayKey = series.at(-1)?.key ?? "";
  const [selectedDay, setSelectedDay] = useSourceDraft(todayKey, todayKey);
  const selected = series.find((point) => point.key === selectedDay) ?? series.at(-1);
  const selectedLabel = selected?.key === todayKey ? "Today" : (selected?.label ?? "Today");
  const verified = agents.filter(
    (agent) => getPublicAgentVerificationStatus(agent).isVerified,
  ).length;
  const tokenized = agents.filter((agent) => Boolean(agent.linkedToken)).length;
  return (
    <PublicSitePanel className="gap-0 overflow-hidden p-0">
      <div className="grid grid-cols-2 gap-px bg-border/40 sm:grid-cols-4">
        <div className="bg-background/80 px-3 py-3.5 sm:px-4">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            Total
          </p>
          <StatValue>{agents.length}</StatValue>
        </div>
        <div className="bg-background/80 px-3 py-3.5 sm:px-4">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            {selectedLabel}
          </p>
          <StatValue>{selected?.count ?? 0}</StatValue>
          <DayBars
            series={series}
            selectedKey={selected?.key ?? todayKey}
            onSelect={setSelectedDay}
          />
        </div>
        <div className="bg-background/80 px-3 py-3.5 sm:px-4">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            Verified
          </p>
          <StatValue>{verified}</StatValue>
        </div>
        <div className="bg-background/80 px-3 py-3.5 sm:px-4">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            Tokenized
          </p>
          <StatValue>{tokenized}</StatValue>
        </div>
      </div>
    </PublicSitePanel>
  );
}
export function PublicAgentsIndex({ agents, initialSort = "agent_rank" }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PublicAgentSortKey>(initialSort);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useArLiveFeedRefresh({ kinds: ["agent_launch", "token_launch"] });
  const filtered = useMemo(() => {
    const q = query.trim();
    const rows = agents
      .map((row) => ({
        row,
        relevance: q ? computeAgentSearchRelevance(row, q) : 0,
        sortable: toSortable(row),
      }))
      .filter(({ relevance }) => !q || relevance > 0);
    rows.sort((a, b) => {
      if (q && a.relevance !== b.relevance) {
        return b.relevance - a.relevance;
      }
      return compareByAgentSort(a.sortable, b.sortable, sort);
    });
    return rows.map(({ row }) => row);
  }, [agents, query, sort]);
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const remaining = Math.max(0, filtered.length - visible.length);
  const resetVisible = () => setVisibleCount(PAGE_SIZE);
  const shareInput = useMemo(() => {
    const series = buildAgentDaySeries(agents, 7);
    return {
      total: agents.length,
      today: series.at(-1)?.count ?? 0,
      verified: agents.filter(
        (agent) => getPublicAgentVerificationStatus(agent).isVerified,
      ).length,
      tokenized: agents.filter((agent) => Boolean(agent.linkedToken)).length,
      series,
    };
  }, [agents]);
  return (
    <div className="ui-page-stack space-y-4">
      <AgentStats agents={agents} />
      <PublicAgentsBrowseToolbar
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          resetVisible();
        }}
        sort={sort}
        onSortChange={(value) => {
          setSort(value);
          resetVisible();
        }}
        trailingActions={<AgentsShareButton shareInput={shareInput} />}
      />
      <div className="flex items-center justify-end px-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground tabular-nums">
          {visible.length} of {filtered.length} agents
        </p>
      </div>
      {filtered.length === 0 ? (
        <PublicSiteEmptyState message="No agents match your filters." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((agent) => (
              <AgentMarketCard key={agent.id} agent={agent} />
            ))}
          </div>
          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={remaining === 0}
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="ui-btn ui-btn-secondary ui-btn-sm ui-btn-fit transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              aria-disabled={remaining === 0}
            >
              View more ({remaining})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
