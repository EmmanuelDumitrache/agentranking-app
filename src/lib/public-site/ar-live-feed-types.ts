export type ArLiveFeedKind =
  | "buy"
  | "sell"
  | "token_launch"
  | "agent_launch"
  | "fees"
  | "verified"
  | "milestone"
  | "digest";
export type ArLiveFeedChain = "solana" | "robinhood";
export type ArLiveFeedEvent = {
  id: string;
  kind: ArLiveFeedKind;
  chain: ArLiveFeedChain;
  title: string;
  subtitle?: string;
  symbol: string | null;
  name: string | null;
  amountLabel: string | null;
  href: string;
  occurredAt: string;
};
/** Bonding / graduation progress bands (0–100). */
export const AR_LIVE_FEED_BONDING_THRESHOLDS = [25, 50, 75, 100] as const;
/** Holder-count milestone bands. */
export const AR_LIVE_FEED_HOLDER_THRESHOLDS = [10, 50, 100, 500] as const;
/** Minimum buy size (USD) to surface in the live feed for AR-listed tokens. */
export const AR_LIVE_FEED_MIN_BUY_USD = 10;
/** Buy size (USD) that upgrades the title to “Large buy”. */
export const AR_LIVE_FEED_LARGE_BUY_USD = 50;
/** ETH size that upgrades a Robinhood buy title to “Large buy” (~$50 at $3k ETH). */
export const AR_LIVE_FEED_LARGE_BUY_ETH = 0.017;
/** ETH size for minimum displayed Robinhood buy (~$10 at $3k ETH). */
export const AR_LIVE_FEED_MIN_BUY_ETH = 0.0035;
export function formatArLiveFeedAmount(
  amount: number | string | bigint | null | undefined,
  unit?: string,
): string | null {
  const numeric = normalizeAmountNumber(amount);
  if (numeric == null) return null;
  const abs = Math.abs(numeric);
  const sign = numeric < 0 ? "-" : "";
  let label: string;
  if (abs >= 1_000_000_000_000) {
    label = `${sign}${trimFixed(abs / 1_000_000_000_000, 1)}T`;
  } else if (abs >= 1_000_000_000) {
    label = `${sign}${trimFixed(abs / 1_000_000_000, 1)}B`;
  } else if (abs >= 1_000_000) {
    label = `${sign}${trimFixed(abs / 1_000_000, 1)}M`;
  } else if (abs >= 1_000) {
    label = `${sign}${trimFixed(abs / 1_000, 1)}K`;
  } else if (abs >= 1) {
    label = `${sign}${trimFixed(abs, abs >= 100 ? 0 : 2)}`;
  } else if (abs > 0) {
    label = `${sign}${trimFixed(abs, 4)}`;
  } else {
    label = "0";
  }
  return unit ? `${label} ${unit}` : label;
}
/**
 * Thresholds newly crossed when moving from `previous` → `next`.
 * Empty when `previous` is null (cold watermark init — do not emit history).
 */
export function newlyCrossedThresholds(
  previous: number | null,
  next: number,
  thresholds: readonly number[],
): number[] {
  if (previous == null || !Number.isFinite(next)) return [];
  return thresholds.filter((threshold) => previous < threshold && next >= threshold);
}
function normalizeAmountNumber(amount: number | string | bigint | null | undefined): number | null {
  if (amount == null) return null;
  if (typeof amount === "bigint") return Number(amount);
  if (typeof amount === "number") return Number.isFinite(amount) ? amount : null;
  const numeric = Number.parseFloat(amount);
  return Number.isFinite(numeric) ? numeric : null;
}
function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
