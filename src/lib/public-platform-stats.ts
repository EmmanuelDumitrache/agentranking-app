import { SITE_STATS_LABELS } from "@/lib/site-config";
export const PUBLIC_PLATFORM_STATS_DISPLAY = {
  partnersMin: 7,
  snapshotSeconds: 60,
} as const;
export type PublicHomeStats = {
  readonly totalAgents: number;
  readonly totalChains: number;
  readonly mcpAgents: number;
  readonly verifiedAgents: number;
  readonly sapVerifiedAgents: number;
  readonly generatedAt: string;
  /** True when the payload contains current persisted counters. */
  readonly isLive: boolean;
};
export function resolvePublicHomeStats(live: {
  totalAgents: number;
  totalChains: number;
  mcpAgents: number;
  verifiedAgents: number;
  sapVerifiedAgents: number;
  generatedAt: string;
}): PublicHomeStats {
  return { ...live, isLive: true };
}
export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}
export function formatCompactPlus(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) {
    const compact = value / 1_000_000;
    return compact >= 10
      ? `${Math.round(compact)}m+`
      : `${(Math.floor(value / 100_000) / 10).toFixed(1).replace(/\.0$/, "")}m+`;
  }
  if (value >= 1_000) return `${Math.floor(value / 1_000)}k+`;
  return formatInteger(value);
}
export function buildPublicStatsDisplay(stats: PublicHomeStats, partnerCount: number) {
  return {
    agents: formatCompactPlus(stats.totalAgents),
    chains: formatInteger(stats.totalChains),
    mcp: formatInteger(stats.mcpAgents),
    partners: `${Math.max(partnerCount, PUBLIC_PLATFORM_STATS_DISPLAY.partnersMin)}+`,
    snapshot: `~${PUBLIC_PLATFORM_STATS_DISPLAY.snapshotSeconds}s`,
  };
}
/** Client + SSR strip rows for public-site home stats cards. */
export type PublicStatsStripItem = {
  readonly label: string;
  readonly value: string;
  readonly numericValue?: number;
};
export function buildPublicStatsStripItems(
  stats: PublicHomeStats,
  partnerCount: number,
): PublicStatsStripItem[] {
  const display = buildPublicStatsDisplay(stats, partnerCount);
  return [
    { label: SITE_STATS_LABELS.agents, value: display.agents, numericValue: stats.totalAgents },
    { label: SITE_STATS_LABELS.chains, value: display.chains, numericValue: stats.totalChains },
    { label: SITE_STATS_LABELS.mcp, value: display.mcp, numericValue: stats.mcpAgents },
    {
      label: SITE_STATS_LABELS.partners,
      value: display.partners,
      numericValue: Math.max(partnerCount, PUBLIC_PLATFORM_STATS_DISPLAY.partnersMin),
    },
  ];
}
/** Poll interval for live stats on public pages — matches SSR revalidate + /api/v1/stats cache. */
export const PUBLIC_STATS_POLL_MS = PUBLIC_PLATFORM_STATS_DISPLAY.snapshotSeconds * 1000;
