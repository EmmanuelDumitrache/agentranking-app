/** Format a USD value as compact string — "$1.23K", "$4.5M", "$0.00012", "—". */
export function formatUsdCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (abs >= 1) return `$${value.toFixed(2)}`;
  if (abs >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}
/** Format a USD price with clean human-readable output.
 *
 *  >= 1             → "$1.23"
 *  >= 0.000001      → "$0.000583"
 *  <  0.000001      → "<$0.000001"
 *  null/undefined   → "—"
 *
 * No subscript, no scientific notation, no unreasonable decimal strings.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (abs >= 0.000001) return `$${value.toFixed(6)}`;
  return "<$0.000001";
}
