"use client";

import { Copy, ExternalLink } from "lucide-react";
import { RuntimeImage } from "@/components/shared/runtime-image";
import { Button } from "@/components/ui/button";
import type { CopyLeaderboardTrader } from "@/lib/agent-trading/copy-trade/types";
import { perpsoWalletProfileUrl } from "@/lib/agent-trading/perpso/urls";
import { cn } from "@/lib/utils";

const SOLANA_LOGO = "/branding/solana/solanaLogoMark.svg";

type Props = {
  readonly trader: CopyLeaderboardTrader;
  readonly onCopy: (trader: CopyLeaderboardTrader) => void;
};

function shortenWallet(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function displayName(trader: CopyLeaderboardTrader): string {
  return trader.label ?? shortenWallet(trader.wallet);
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/** Compact sparkline that fills its box edge-to-edge (no letterboxing). */
function PnlSparkline({
  values,
  positive,
}: {
  readonly values: number[];
  readonly positive: boolean;
}) {
  if (values.length < 2) {
    return (
      <div className="flex h-10 flex-1 items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 text-[10px] text-muted-foreground">
        No chart
      </div>
    );
  }

  const w = 120;
  const h = 28;
  const padY = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * w;
    const y = padY + (1 - (value - min) / range) * (h - padY * 2);
    return { x, y };
  });

  const line = coords
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const area = `${line} L${last.x.toFixed(2)},${h} L${first.x.toFixed(2)},${h} Z`;

  const stroke = positive ? "#d4d4d8" : "#ef4444";
  const fill = positive ? "rgba(212, 212, 216, 0.16)" : "rgba(239, 68, 68, 0.2)";

  return (
    <div className="h-10 min-w-0 flex-1 overflow-hidden rounded-md border border-border/40 bg-muted/10">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="block h-full w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path d={area} fill={fill} />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function CopyTradeLeaderboardCard({ trader, onCopy }: Props) {
  const isPositive = trader.pnlUsd >= 0;
  const sparkline = trader.pnlSparkline ?? [];
  const assetIcon = trader.topAssetIcon ?? SOLANA_LOGO;
  const assetSymbol = trader.topAssetSymbol ?? "SOL";
  const profileUrl = trader.profileUrl ?? perpsoWalletProfileUrl(trader.wallet);
  const showWalletSubtitle = Boolean(trader.label);

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-[#212121] p-3.5">
      <div className="flex items-start gap-3">
        <RuntimeImage src={SOLANA_LOGO} alt="" className="size-9 shrink-0" aria-hidden />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              #{trader.rank || "—"}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/50 bg-[#272727] px-2 py-0.5 text-[11px] font-medium">
              <RuntimeImage src={assetIcon} alt="" className="size-3 shrink-0 rounded-full" aria-hidden />
              {assetSymbol}
            </span>
          </div>

          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex min-w-0 items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate font-mono text-sm font-semibold leading-snug group-hover:underline">
              {displayName(trader)}
            </span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-70 group-hover:opacity-100" />
          </a>

          {showWalletSubtitle ? (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {shortenWallet(trader.wallet)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex h-10 items-center gap-2">
        <PnlSparkline values={sparkline} positive={isPositive} />
        <div className="flex h-10 w-[5.25rem] shrink-0 flex-col items-end justify-center">
          <span className="text-[10px] leading-none text-muted-foreground">30d PnL</span>
          <span
            className={cn(
              "mt-0.5 text-sm font-semibold leading-none tabular-nums",
              isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400",
            )}
          >
            {formatUsd(trader.pnlUsd)}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Win rate</dt>
          <dd className="truncate font-medium tabular-nums">
            {trader.trades > 0 && trader.winRate > 0 ? `${trader.winRate.toFixed(1)}%` : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Trades</dt>
          <dd className="truncate font-medium tabular-nums">{trader.trades}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Volume</dt>
          <dd className="truncate font-medium tabular-nums">{formatUsd(trader.volumeUsd)}</dd>
        </div>
      </dl>

      <Button
        variant="secondary"
        size="sm"
        className="w-fit self-center"
        onClick={() => onCopy(trader)}
      >
        <Copy className="size-3.5" aria-hidden />
        Copy trader
      </Button>
    </article>
  );
}
