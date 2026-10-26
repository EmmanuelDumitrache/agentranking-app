"use client";
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
const METALLIC_RANK_TIER: Record<1 | 2 | 3, string> = {
  1: "from-amber-100 via-yellow-300 to-amber-600 text-amber-950 border-amber-50/60 shadow-[inset_0_2px_6px_rgba(255,255,255,0.55),inset_0_-3px_8px_rgba(120,53,15,0.35),0_2px_8px_rgba(0,0,0,0.25)]",
  2: "from-zinc-50 via-slate-200 to-zinc-500 text-zinc-900 border-white/50 shadow-[inset_0_2px_6px_rgba(255,255,255,0.85),inset_0_-3px_8px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.2)]",
  3: "from-orange-200 via-amber-500 to-orange-900 text-amber-950 border-orange-100/50 shadow-[inset_0_2px_5px_rgba(255,255,255,0.45),inset_0_-3px_8px_rgba(124,45,18,0.4),0_2px_8px_rgba(0,0,0,0.25)]",
};
export function MetallicRankBadge({
  place,
  compact = false,
  className,
}: {
  readonly place: 1 | 2 | 3;
  /** Smaller disk for dense UI (e.g. leaderboard table); no side margin */
  readonly compact?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border bg-gradient-to-br font-black tabular-nums ring-1 ring-black/15",
        compact
          ? "h-7 w-7 text-xs"
          : "h-9 w-9 text-lg sm:h-10 sm:w-10 sm:text-xl mr-2 sm:mr-3",
        METALLIC_RANK_TIER[place],
        className
      )}
      aria-label={`Rank ${place}`}
    >
      {place}
    </span>
  );
}
export interface DestinationCardProps extends React.HTMLAttributes<HTMLDivElement> {
  imageUrl: string;
  location: string;
  /** Optional emoji or short label when `rankPlace` is not used */
  flag?: string;
  /** Renders a metallic gold / silver / bronze disk with this number */
  rankPlace?: 1 | 2 | 3;
  stats: string;
  href: string;
  /** HSL components only, e.g. `"150 50% 25%"` for use inside `hsl(var(--theme-color) / …)` */
  themeColor: string;
  ctaLabel?: string;
}
const DestinationCard = React.forwardRef<HTMLDivElement, DestinationCardProps>(
  (
    {
      className,
      imageUrl,
      location,
      flag,
      rankPlace,
      stats,
      href,
      themeColor,
      ctaLabel = "Explore Now",
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        style={
          {
            "--theme-color": themeColor,
          } as React.CSSProperties
        }
        className={cn("group h-full w-full", className)}
        {...props}
      >
        <Link
          href={href}
          className={cn(
            "relative block h-full w-full overflow-hidden rounded-2xl shadow-lg",
            "transition-all duration-500 ease-in-out",
            "group-hover:scale-105 group-hover:shadow-[0_0_60px_-15px_hsl(var(--theme-color)/0.6)]"
          )}
          aria-label={`Explore details for ${location}`}
          style={{
            boxShadow: "0 0 40px -15px hsl(var(--theme-color) / 0.5)",
          }}
        >
          <div
            className={cn(
              "absolute inset-0 bg-cover bg-center",
              "transition-transform duration-500 ease-in-out group-hover:scale-110"
            )}
            style={{ backgroundImage: `url(${imageUrl})` }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, hsl(var(--theme-color) / 0.9), hsl(var(--theme-color) / 0.6) 30%, transparent 60%)",
            }}
          />
          <div className="relative flex h-full flex-col justify-end p-6 text-white">
            <h3 className="line-clamp-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {rankPlace != null ? <MetallicRankBadge place={rankPlace} /> : null}
              <span className="min-w-0">{location}</span>
              {rankPlace == null && flag ? (
                <span className="text-xl sm:text-2xl">{flag}</span>
              ) : null}
            </h3>
            <p className="mt-1 line-clamp-3 text-sm font-medium text-white/80">{stats}</p>
            <div
              className={cn(
                "mt-8 flex items-center justify-between rounded-lg border px-4 py-3",
                "border-[hsl(var(--theme-color)/0.3)] bg-[hsl(var(--theme-color)/0.2)] backdrop-blur-md",
                "transition-all duration-300",
                "group-hover:border-[hsl(var(--theme-color)/0.5)] group-hover:bg-[hsl(var(--theme-color)/0.4)]"
              )}
            >
              <span className="text-sm font-semibold tracking-wide">{ctaLabel}</span>
              <ArrowRight className="h-4 w-4 transform transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </div>
        </Link>
      </div>
    );
  }
);
DestinationCard.displayName = "DestinationCard";
export { DestinationCard };