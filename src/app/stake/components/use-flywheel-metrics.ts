"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FEE_FLYWHEEL_ALLOCATION_PCT } from "@/lib/token-economy-copy";
import type { ArTokenMetricsView } from "@/lib/ar-token-metrics";
import type { StakePageMetricsDto } from "@/lib/stake-page-data";
import { stakeKeys } from "@/lib/query-keys/stake";
export type StakeHeroMetrics = {
  totalStaked: string;
  activeStakers: string;
  rewardsDistributed: string;
  feesAllocated: string;
  lockedSupplyPercent: string;
  nextRewardCycle: string;
};
const EMPTY_METRICS: StakeHeroMetrics = {
  totalStaked: "",
  activeStakers: "",
  rewardsDistributed: "",
  feesAllocated: "",
  lockedSupplyPercent: "",
  nextRewardCycle: "",
};
function formatTokenCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M $AR`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K $AR`;
  return `${n.toLocaleString()} $AR`;
}
function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
function mapMetricsToHero(data: StakePageMetricsDto): Partial<StakeHeroMetrics> {
  const t = data.totals;
  const hasData =
    t.stakedSupplyToken > 0 ||
    t.activeStakers > 0 ||
    t.totalRewardsToken > 0 ||
    t.totalRevenueUsd > 0 ||
    t.totalBuybackUsd > 0;
  if (!hasData) return {};
  return {
    totalStaked: formatTokenCompact(t.stakedSupplyToken),
    activeStakers: t.activeStakers > 0 ? String(t.activeStakers) : "",
    rewardsDistributed: formatTokenCompact(t.totalRewardsToken),
    feesAllocated: formatUsdCompact(t.totalRevenueUsd * FEE_FLYWHEEL_ALLOCATION_PCT),
    lockedSupplyPercent: "",
    nextRewardCycle: "",
  };
}
export function useFlywheelMetrics(initialMetrics?: StakePageMetricsDto | null): {
  metrics: StakeHeroMetrics;
  loading: boolean;
  hasLiveMetrics: boolean;
  liveTotals: StakePageMetricsDto["totals"] | null;
  error: string | null;
} {
  const query = useQuery<StakePageMetricsDto>({
    queryKey: stakeKeys.metrics(),
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/token/metrics", { cache: "no-store", signal });
      if (!res.ok) {
        throw new Error("Metrics API unavailable");
      }
      const response = (await res.json()) as ArTokenMetricsView;
      return { generatedAt: new Date().toISOString(), totals: response.totals };
    },
    initialData: initialMetrics ?? undefined,
    refetchOnMount: false,
  });
  const data = query.data ?? null;
  const mapped = useMemo(
    () => (data ? mapMetricsToHero(data) : {}),
    [data],
  );
  const hasLiveMetrics = Object.keys(mapped).length > 0;
  const metrics = useMemo<StakeHeroMetrics>(
    () => ({ ...EMPTY_METRICS, ...mapped }),
    [mapped],
  );
  const error = query.isError
    ? query.error?.message ?? "Could not reach metrics API"
    : data && !hasLiveMetrics
      ? "No live staking metrics yet"
      : null;
  return {
    metrics,
    loading: query.isPending,
    hasLiveMetrics,
    liveTotals: data?.totals ?? null,
    error,
  };
}
