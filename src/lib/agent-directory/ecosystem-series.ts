export type EcosystemSeriesPoint = {
  date: string;
  value: number;
};
export type EcosystemTimeseries = {
  total: EcosystemSeriesPoint[];
  verified: EcosystemSeriesPoint[];
  mcp: EcosystemSeriesPoint[];
  x402: EcosystemSeriesPoint[];
  feedback: EcosystemSeriesPoint[];
  networks: EcosystemSeriesPoint[];
};
export const ECOSYSTEM_SERIES_DAYS = 30;
/** Slice cumulative UTC series for a stats time-window tab. */
export function sliceEcosystemSeries(
  series: EcosystemSeriesPoint[] | undefined,
  window: "all" | "24h" | "7d" | "30d" | "live",
): EcosystemSeriesPoint[] {
  if (!series?.length) return [];
  const normalized = window === "live" ? "24h" : window;
  const days =
    normalized === "24h"
      ? 1
      : normalized === "7d"
        ? 7
        : normalized === "30d"
          ? 30
          : ECOSYSTEM_SERIES_DAYS;
  return series.slice(-days);
}