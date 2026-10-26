"use client";
import { useState } from "react";
import {
  ANALYTICS_ARCHETYPE_BARS,
  ANALYTICS_CHAIN_MIX,
  ANALYTICS_DASHBOARD_TABS,
  ANALYTICS_DEMAND_30D,
  ANALYTICS_GROWTH_30D,
  ANALYTICS_HEATMAP_COLS,
  ANALYTICS_HEATMAP_ROWS,
  ANALYTICS_HEATMAP_VALUES,
  ANALYTICS_PREVIEW_KPIS,
  ANALYTICS_TOP_MOVERS,
  type AnalyticsDashboardTab,
} from "@/lib/analytics-preview-data";
import { cn } from "@/lib/utils";
function heatColor(v: number): string {
  if (v >= 0.8) return "rgb(34 211 238 / 0.85)";
  if (v >= 0.65) return "rgb(59 130 246 / 0.7)";
  if (v >= 0.5) return "rgb(99 102 241 / 0.55)";
  if (v >= 0.35) return "rgb(71 85 105 / 0.45)";
  return "rgb(51 65 85 / 0.35)";
}
function MiniBars({
  data,
  colorClass,
}: {
  readonly data: readonly { date: string; count: number }[];
  readonly colorClass: string;
}) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex h-20 items-end gap-1" aria-hidden>
      {data.map((d) => (
        <div
          key={d.date}
          className={cn("flex-1 rounded-t-sm", colorClass)}
          style={{ height: `${Math.round((d.count / max) * 100)}%`, minHeight: "4px" }}
        />
      ))}
    </div>
  );
}
function HeatmapGrid() {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-1 min-w-[280px]"
        style={{ gridTemplateColumns: `64px repeat(${ANALYTICS_HEATMAP_COLS.length}, 1fr)` }}
      >
        <div />
        {ANALYTICS_HEATMAP_COLS.map((col) => (
          <div key={col} className="pb-1 text-center text-[9px] font-medium text-muted-foreground">
            {col}
          </div>
        ))}
        {ANALYTICS_HEATMAP_ROWS.map((row, ri) => (
          <div key={row} className="contents">
            <div className="flex items-center text-[9px] font-medium text-muted-foreground pr-1">{row}</div>
            {ANALYTICS_HEATMAP_COLS.map((col, ci) => {
              const v = ANALYTICS_HEATMAP_VALUES[ri]?.[ci] ?? 0;
              return (
                <div
                  key={`${row}-${col}`}
                  className="aspect-[1.35] min-h-[22px] rounded-sm"
                  style={{ backgroundColor: heatColor(v) }}
                  title={`${row} × ${col}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
function TabPanel({ tab }: { readonly tab: AnalyticsDashboardTab }) {
  if (tab === "pulse") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {ANALYTICS_PREVIEW_KPIS.map((kpi) => (
            <div key={kpi.label} className="rounded-lg border border-blue-500/15 bg-blue-500/5 p-2">
              <p className="text-sm font-bold tabular-nums text-foreground">{kpi.value}</p>
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
              <p className="text-[9px] text-blue-300/80">{kpi.delta}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border/70 bg-card/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-300/90">
            Agent registrations (30d)
          </p>
          <MiniBars data={ANALYTICS_GROWTH_30D} colorClass="bg-gradient-to-t from-blue-600/50 to-cyan-400/70" />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Chain mix</p>
          {ANALYTICS_CHAIN_MIX.map((c) => {
            const max = ANALYTICS_CHAIN_MIX[0]!.count;
            const pct = Math.round((c.count / max) * 100);
            return (
              <div key={c.name} className="flex items-center gap-2 text-[10px]">
                <span className="w-10 shrink-0 font-medium text-muted-foreground">{c.name}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: c.color }} />
                </div>
                <span className="w-10 text-right tabular-nums text-muted-foreground">
                  {(c.count / 1000).toFixed(1)}k
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (tab === "graph") {
    return (
      <div className="space-y-3">
        <HeatmapGrid />
        <div className="rounded-lg border border-border/70 bg-card/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-300/90">By archetype</p>
          <div className="mt-2 space-y-1.5">
            {ANALYTICS_ARCHETYPE_BARS.map((row) => {
              const max = ANALYTICS_ARCHETYPE_BARS[0]!.count;
              const pct = Math.round((row.count / max) * 100);
              return (
                <div key={row.label} className="flex items-center gap-2 text-[10px]">
                  <span className="w-14 shrink-0 text-muted-foreground">{row.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-indigo-500/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right tabular-nums text-muted-foreground">
                    {(row.count / 1000).toFixed(1)}k
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/70 bg-card/40 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-300/90">
          Demand index (30d)
        </p>
        <MiniBars data={ANALYTICS_DEMAND_30D} colorClass="bg-gradient-to-t from-violet-600/50 to-blue-400/70" />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Top movers (reputation)
        </p>
        <ul className="space-y-1.5">
          {ANALYTICS_TOP_MOVERS.map((agent, i) => (
            <li
              key={agent.name}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5 text-[10px]"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-muted-foreground tabular-nums w-4">{i + 1}</span>
                <span className="font-medium truncate">{agent.name}</span>
                <span className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground">
                  {agent.chain}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold text-foreground">{agent.score}</span>
                <span className="ml-1 text-emerald-400">{agent.delta}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
export function AnalyticsPreviewDashboard({
  className,
  showDisclaimer = true,
}: {
  readonly className?: string;
  readonly showDisclaimer?: boolean;
}) {
  const [tab, setTab] = useState<AnalyticsDashboardTab>("pulse");
  return (
    <div className={cn("text-left", className)}>
      <div className="flex flex-wrap gap-1 border-b border-border bg-muted/10 p-2">
        {ANALYTICS_DASHBOARD_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
              tab === t.id
                ? "bg-blue-500/15 text-blue-200 border border-blue-500/30"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-3 md:p-4">
        <TabPanel tab={tab} />
      </div>
      {showDisclaimer ? (
        <p className="border-t border-border/60 px-3 py-2 text-[9px] text-center text-muted-foreground">
          Preview · illustrative data only · not for trading or investment decisions
        </p>
      ) : null}
    </div>
  );
}
