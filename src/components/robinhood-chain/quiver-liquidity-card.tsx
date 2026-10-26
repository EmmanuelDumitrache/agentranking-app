import Image from "next/image";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { quiverfunTokenUrl } from "@/lib/robinhood-chain/quiverfun-urls";

type Props = {
  readonly tokenAddress: string;
  readonly tokenSymbol?: string | null;
  readonly detailLabel?: string | null;
  readonly statusLabel?: string;
  readonly featured?: boolean;
  readonly compact?: boolean;
  readonly className?: string;
};

/**
 * Quiver V3 has no bonding curve — show liquidity status + Quiverfun link
 * instead of a fake graduation progress bar.
 */
export function QuiverLiquidityCard({
  tokenAddress,
  tokenSymbol,
  detailLabel = "Uniswap v3 · LP locked at launch",
  statusLabel = "Live",
  featured = false,
  compact = false,
  className,
}: Props) {
  const symbol = tokenSymbol?.trim();
  const title = symbol ? `$${symbol} · Quiver` : "Quiver";
  const href = quiverfunTokenUrl(tokenAddress);

  if (compact) {
    return (
      <div className={cn("mt-2 flex items-center justify-between gap-2 text-xs", className)}>
        <span className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider">
          <Image
            src="/partners/quiver/quiver-logo.png"
            alt=""
            width={14}
            height={14}
            className="rounded-sm object-cover"
          />
          {title}
        </span>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-amber-500 hover:underline dark:text-amber-400"
        >
          {statusLabel}
          <ExternalLink className="size-3 opacity-70" aria-hidden />
        </a>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5",
        featured && "relative overflow-hidden",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <div className="flex items-center gap-3">
          <Image
            src="/partners/quiver/quiver-logo.png"
            alt="Quiver"
            width={featured ? 40 : 32}
            height={featured ? 40 : 32}
            className="shrink-0 rounded-md border border-border/40 object-cover"
          />
          <div className="min-w-0 space-y-0.5">
            <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
              {title}
            </p>
            <p className="text-sm font-medium text-foreground">
              {detailLabel}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted/60"
          >
            View on Quiverfun
            <ExternalLink className="size-3 opacity-70" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}
