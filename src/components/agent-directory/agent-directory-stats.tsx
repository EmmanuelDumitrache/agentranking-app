"use client";
import { RefreshCcw } from "lucide-react";
import type { DirectoryEcosystemStats, DirectoryTimeWindow } from "@/lib/agent-directory/types";
import { DIRECTORY_TIME_WINDOWS } from "@/lib/agent-directory/filters";
import { ScannerLayoutToggle } from "@/components/scanner/scanner-layout-toggle";
import { useScannerLayoutContextOptional } from "@/components/scanner/scanner-layout-context";
import {
  PublicSiteFilterChip,
  PublicSiteFilterIsland,
} from "@/components/public-site/public-site-filter-chips";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import { cn } from "@/lib/utils";
import { formatHomeHeroMetric } from "@/lib/home-discovery-display";
function AgentDirectoryStatsToolbar({
  timeWindow,
  onTimeWindowChange,
  isRefreshing,
  onRefresh,
}: {
  readonly timeWindow: DirectoryTimeWindow;
  readonly onTimeWindowChange: (w: DirectoryTimeWindow) => void;
  readonly isRefreshing?: boolean;
  readonly onRefresh?: () => void;
}) {
  const layoutCtx = useScannerLayoutContextOptional();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PublicSiteFilterIsland aria-label="Time window" className="w-full sm:w-auto">
        {DIRECTORY_TIME_WINDOWS.map((w) => (
          <PublicSiteFilterChip
            key={w.value}
            active={timeWindow === w.value}
            onClick={() => onTimeWindowChange(w.value)}
          >
            {w.label}
          </PublicSiteFilterChip>
        ))}
      </PublicSiteFilterIsland>
      <div className="flex items-center gap-2">
        {layoutCtx ? (
          <ScannerLayoutToggle
            layout={layoutCtx.layout}
            onLayoutChange={layoutCtx.setLayout}
            variant="public-site"
          />
        ) : null}
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20 text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Refresh agents"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
function StatCell({
  label,
  value,
  isLoading,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly isLoading: boolean;
}) {
  const displayValue = (() => {
    if (isLoading) return "—";
    if (value == null) return "—";
    return formatHomeHeroMetric(value)?.display ?? "—";
  })();
  return (
    <div className="bg-background/80 px-3 py-3.5 sm:px-4">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl">
        {displayValue}
      </p>
    </div>
  );
}
export function AgentDirectoryStats({
  stats,
  timeWindow,
  onTimeWindowChange,
  isLoading = false,
  isRefreshing,
  onRefresh,
  listedAgents,
  hasActiveDirectoryFilters = false,
}: {
  readonly stats?: DirectoryEcosystemStats | null;
  readonly timeWindow: DirectoryTimeWindow;
  readonly onTimeWindowChange: (w: DirectoryTimeWindow) => void;
  readonly isLoading?: boolean;
  readonly isRefreshing?: boolean;
  readonly onRefresh?: () => void;
  readonly listedAgents?: number | null;
  readonly hasActiveDirectoryFilters?: boolean;
}) {
  return (
    <div className="space-y-3">
      <PublicSitePanel className="gap-3 p-4">
        <AgentDirectoryStatsToolbar
          timeWindow={timeWindow}
          onTimeWindowChange={onTimeWindowChange}
          isRefreshing={isRefreshing}
          onRefresh={onRefresh}
        />
      </PublicSitePanel>
      <PublicSitePanel className="gap-0 overflow-hidden p-0">
        <div className="grid grid-cols-2 gap-px bg-border/40 sm:grid-cols-4">
          <StatCell
            label={hasActiveDirectoryFilters ? "Matching Agents" : "Listed Agents"}
            value={listedAgents ?? null}
            isLoading={listedAgents == null && isLoading}
          />
          <StatCell
            label="Verified"
            value={stats?.verifiedAgents ?? null}
            isLoading={isLoading}
          />
          <StatCell
            label="Chains"
            value={stats?.totalChains ?? null}
            isLoading={isLoading}
          />
          <StatCell
            label="x402 Ready"
            value={stats?.x402Agents ?? null}
            isLoading={isLoading}
          />
        </div>
      </PublicSitePanel>
    </div>
  );
}
