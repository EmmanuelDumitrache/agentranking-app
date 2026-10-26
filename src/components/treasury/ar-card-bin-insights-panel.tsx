"use client";

import {
  AR_CARD_PLATFORMS,
  type ArCardBinOption,
} from "@/lib/agent-payments/providers/card/ar-card-bins";
import { cn } from "@/lib/utils";

function PlatformTile({ platformId }: { platformId: string }) {
  const platform = AR_CARD_PLATFORMS[platformId];
  if (!platform) return null;

  const isLight = platform.color.toLowerCase() === "#ffffff" || platform.color === "#FFFFFF";

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-background/50 px-1 py-2">
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-md text-xs font-bold",
          isLight ? "bg-white/10 text-white ring-1 ring-white/15" : "text-white",
        )}
        style={isLight ? undefined : { backgroundColor: `${platform.color}22`, color: platform.color }}
        aria-hidden
      >
        {platform.shortLabel || platform.name.slice(0, 1)}
      </span>
      <span className="max-w-full truncate px-0.5 text-[9px] font-medium text-muted-foreground">
        {platform.name}
      </span>
    </div>
  );
}

type Props = {
  option: ArCardBinOption;
  className?: string;
};

export function ArCardBinPlatformsPanel({ option, className }: Props) {
  const visiblePlatforms = option.platforms
    .map((id) => AR_CARD_PLATFORMS[id])
    .filter(Boolean)
    .slice(0, 12);
  const moreCount = Math.max(0, option.platforms.length - visiblePlatforms.length);

  return (
    <div className={cn("rounded-xl border border-border/80 bg-muted/10 p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          / Applicable platforms
        </p>
        {moreCount > 0 ? (
          <span className="text-[10px] font-medium text-muted-foreground">+{moreCount} more</span>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {visiblePlatforms.map((platform) => (
          <PlatformTile key={platform.id} platformId={platform.id} />
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Acceptance varies by merchant and region. Not all platforms guarantee approval.
      </p>
    </div>
  );
}
