import {
  formatArLiveFeedAmount,
} from "@/lib/public-site/ar-live-feed-types";
export function formatTradeFeedTitle(input: {
  kind: "buy" | "sell";
  symbol: string | null;
  amountLabel: string | null;
  quoteLabel: string | null;
  large?: boolean;
  /** Prefer USD-first titles for meaningful AR buys. */
  usdLabel?: string | null;
}): string {
  const symbolLabel = input.symbol ? `$${input.symbol}` : "Token";
  if (input.kind === "buy" && input.usdLabel) {
    if (input.large) {
      return `Large buy · ${input.usdLabel} ${symbolLabel}`;
    }
    return `Buy · ${input.usdLabel} ${symbolLabel}`;
  }
  if (input.large && input.kind === "buy" && input.quoteLabel) {
    return `Large buy · ${input.quoteLabel} ${symbolLabel}`;
  }
  const action = input.kind === "buy" ? "Bought" : "Sold";
  if (input.amountLabel && input.quoteLabel) {
    return `${action} ${input.amountLabel} ${symbolLabel} · ${input.quoteLabel}`;
  }
  if (input.amountLabel) {
    return `${action} ${input.amountLabel} ${symbolLabel}`;
  }
  return `${action} ${symbolLabel}`;
}
export function formatUsdCompact(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000) return `$${trimFixed(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${trimFixed(value / 1_000, 1)}K`;
  if (value >= 100) return `$${trimFixed(value, 0)}`;
  return `$${trimFixed(value, value >= 10 ? 0 : 2)}`;
}
export function formatSolFromLamports(lamports: bigint | number | string): string | null {
  return formatArLiveFeedAmount(Number(lamports) / 1_000_000_000, "SOL");
}
function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
