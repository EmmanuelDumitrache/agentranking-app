"use client";
import { FEE_FLYWHEEL_ALLOCATION_PCT } from "@/lib/token-economy-copy";
import { useFlywheelMetrics } from "@/app/stake/components/use-flywheel-metrics";
import { cn } from "@/lib/utils";
import type { StakePageMetricsDto } from "@/lib/stake-page-data";
type GridStat = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
};
function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
function formatTokenCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}
export function StakingStatsGrid({ initialMetrics }: { readonly initialMetrics?: StakePageMetricsDto | null }) {
  const { metrics, loading, hasLiveMetrics, liveTotals, error } = useFlywheelMetrics(initialMetrics);
  const gridStats: GridStat[] = [
    { key: "staked", label: "Total staked", value: metrics.totalStaked },
    { key: "buybacks", label: "Buybacks $AR", value: liveTotals ? formatUsd(liveTotals.totalBuybackUsd) : "" },
    { key: "rewards", label: "Staking rewards", value: metrics.rewardsDistributed },
    { key: "fees", label: "Creator & utility fees", value: metrics.feesAllocated },
    { key: "treasury", label: "Treasury balance", value: liveTotals ? formatUsd(liveTotals.treasuryNetUsd) : "" },
    {
      key: "bonus",
      label: "Bonus rewards vault",
      value: liveTotals ? `${formatTokenCompact(liveTotals.totalBountyRewardsToken)} $AR` : "",
    },
    { key: "stakers", label: "Active stakers", value: metrics.activeStakers },
    {
      key: "burned",
      label: "Tokens burned",
      value: liveTotals ? `${formatTokenCompact(liveTotals.totalBurnedToken)} $AR` : "",
    },
    {
      key: "revenue",
      label: "Platform revenue",
      value: liveTotals ? formatUsd(liveTotals.totalRevenueUsd) : "",
      sub:
        liveTotals && liveTotals.totalRevenueUsd > 0
          ? `${Math.round(FEE_FLYWHEEL_ALLOCATION_PCT * 100)}% to flywheel`
          : undefined,
    },
    { key: "locked", label: "Locked supply", value: metrics.lockedSupplyPercent },
    { key: "cycle", label: "Next distribution", value: metrics.nextRewardCycle },
  ];
  const showGlobalPending = !loading && !hasLiveMetrics;
  return (
    <section id="flywheel-metrics" className="pb-8 sm:pb-10" aria-label="Live flywheel stats">
      <div className="ar-public-container">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="ar-public-label">Live flywheel</p>
          <p className="text-[10px] text-[var(--ar-text-muted)]">
            Solana · {loading ? "syncing…" : hasLiveMetrics ? "live metrics" : "awaiting integration"}
          </p>
        </div>
        {showGlobalPending ? (
          <p className="mb-4 rounded-lg border border-[var(--ar-border)] bg-[var(--ar-glass-fill)] px-3 py-2.5 text-[11px] leading-[1.45] text-[var(--ar-text-secondary)]">
            {error ?? "Live staking metrics are not available yet. Pool data will appear when staking events are active."}
          </p>
        ) : null}
        <div className="ar-public-stats-strip w-full min-w-0 overflow-hidden p-0">
          <div className="grid w-full min-w-0 grid-cols-2 gap-px bg-[var(--ar-border)] sm:grid-cols-3 lg:grid-cols-4">
            {gridStats.map((stat) => {
              const hasValue = Boolean(stat.value);
              const display = loading ? null : hasValue ? stat.value : "—";
              return (
                <div
                  key={stat.key}
                  className={cn(
                    "flex min-h-[88px] flex-col justify-center bg-[var(--ar-glass-fill)] px-3 py-3 sm:px-4 sm:py-3.5",
                    hasLiveMetrics && hasValue && "bg-[var(--ar-glass-fill-hover)]",
                  )}
                >
                  <p className="ar-public-label text-[10px]">{stat.label}</p>
                  {loading ? (
                    <div className="ar-public-skeleton mt-2 h-6 w-24" />
                  ) : (
                    <>
                      <p
                        className={cn(
                          "mt-1.5 font-semibold tabular-nums leading-tight",
                          display === "—"
                            ? "text-[20px] text-[var(--ar-text-tertiary)]"
                            : "text-[18px] text-[var(--ar-text-primary)] sm:text-[20px]",
                        )}
                      >
                        {display}
                      </p>
                      {display === "—" && showGlobalPending ? (
                        <p className="mt-0.5 text-[10px] text-[var(--ar-text-muted)]">Pending</p>
                      ) : null}
                      {stat.sub && hasValue ? (
                        <p className="mt-0.5 text-[10px] text-[var(--ar-text-muted)]">{stat.sub}</p>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
