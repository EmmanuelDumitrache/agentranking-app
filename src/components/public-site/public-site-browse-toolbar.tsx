"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import type { ReactNode } from "react";
import {
  BadgeCheck,
  BarChart3,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { cn } from "@/lib/utils";
export type PublicSiteTimeframeKey = "24h" | "week";
export type PublicSiteMetricKey =
  | "volume"
  | "mcap"
  | "new"
  | "verified"
  | "pumpfun"
  | "robinhood";
export const PUBLIC_SITE_TIMEFRAME_OPTIONS: {
  value: PublicSiteTimeframeKey;
  label: string;
}[] = [
  { value: "24h", label: "24h" },
  { value: "week", label: "Week" },
];
export const PUBLIC_SITE_METRIC_OPTIONS: {
  value: PublicSiteMetricKey;
  label: string;
  icon?: LucideIcon;
  mark?: "pumpfun" | "robinhood";
}[] = [
  { value: "volume", label: "24h Volume", icon: BarChart3 },
  { value: "mcap", label: "MCap", icon: TrendingUp },
  { value: "new", label: "New", icon: Sparkles },
  { value: "verified", label: "Verified", icon: BadgeCheck },
  { value: "pumpfun", label: "Pump.fun", mark: "pumpfun" },
  { value: "robinhood", label: "Robinhood", mark: "robinhood" },
];
function FilterIsland({
  children,
  className,
  layout = "inline",
  "aria-label": ariaLabel,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly layout?: "inline" | "stretch" | "scroll";
  readonly "aria-label"?: string;
}) {
  if (layout === "scroll") {
    return (
      <fieldset
        className={cn(
          "m-0 max-w-full min-w-0 w-full overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-1 no-scrollbar [-webkit-overflow-scrolling:touch] overscroll-x-contain lg:w-auto",
          className,
        )}
        aria-label={ariaLabel}
      >
        <div className="flex h-8 w-max items-center gap-0.5">{children}</div>
      </fieldset>
    );
  }
  return (
    <fieldset
      className={cn(
        "m-0 inline-flex max-w-full items-center gap-0.5 rounded-lg border border-border/60 bg-muted/20 p-1",
        layout === "stretch" && "w-full sm:w-auto",
        layout === "inline" && "shrink-0",
        className,
      )}
      aria-label={ariaLabel}
    >
      {children}
    </fieldset>
  );
}
function FilterChip({
  active,
  onClick,
  children,
  className,
  stretch,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly stretch?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        stretch && "min-w-0 flex-1",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
function MetricMark({ mark }: { readonly mark: "pumpfun" | "robinhood" }) {
  if (mark === "robinhood") {
    return <RobinhoodChainIcon className="h-3.5 w-3.5" />;
  }
  return (
    <RuntimeImage
      src="/brandkit/protocol-logos/pumpfun.png"
      alt=""
      className="h-3.5 w-3.5 shrink-0 rounded-sm object-cover"
      aria-hidden
    />
  );
}
type Props = {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly timeframe: PublicSiteTimeframeKey;
  readonly onTimeframeChange: (value: PublicSiteTimeframeKey) => void;
  readonly metric: PublicSiteMetricKey;
  readonly onMetricChange: (value: PublicSiteMetricKey) => void;
  readonly searchPlaceholder?: string;
  readonly searchAriaLabel?: string;
  /** Rendered after the search field (e.g. share control). */
  readonly trailingActions?: ReactNode;
};
export function PublicSiteBrowseToolbar({
  query,
  onQueryChange,
  timeframe,
  onTimeframeChange,
  metric,
  onMetricChange,
  searchPlaceholder = "Search ticker, name, mint or agent…",
  searchAriaLabel = "Search",
  trailingActions,
}: Props) {
  return (
    <PublicSitePanel className="gap-3 p-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:shrink-0">
          <FilterIsland layout="stretch" aria-label="Timeframe" className="lg:shrink-0">
            {PUBLIC_SITE_TIMEFRAME_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                active={timeframe === option.value}
                stretch
                className="sm:flex-initial lg:flex-initial"
                onClick={() => onTimeframeChange(option.value)}
              >
                {option.label}
              </FilterChip>
            ))}
          </FilterIsland>
          <FilterIsland
            layout="scroll"
            aria-label="Sort and filter"
            className="min-w-0 flex-1 sm:w-0 lg:w-auto lg:flex-none lg:shrink-0"
          >
            {PUBLIC_SITE_METRIC_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <FilterChip
                  key={option.value}
                  active={metric === option.value}
                  onClick={() => onMetricChange(option.value)}
                >
                  {option.mark ? <MetricMark mark={option.mark} /> : null}
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                  {option.label}
                </FilterChip>
              );
            })}
          </FilterIsland>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 lg:ml-auto lg:w-auto lg:shrink-0">
          <div className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 w-full rounded-lg border border-border/60 bg-muted/20 pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-border transition-colors"
              aria-label={searchAriaLabel}
            />
            {query ? (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {trailingActions}
        </div>
      </div>
    </PublicSitePanel>
  );
}
