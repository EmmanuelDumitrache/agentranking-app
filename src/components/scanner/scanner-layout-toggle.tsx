"use client";
import { AlignJustify, LayoutGrid } from "lucide-react";
import {
  PublicSiteFilterChip,
  PublicSiteFilterIsland,
} from "@/components/public-site/public-site-filter-chips";
import { cn } from "@/lib/utils";
import type { ScannerTableLayout } from "@/lib/scanner-table-layout";
export function ScannerLayoutToggle({
  layout,
  onLayoutChange,
  className,
  variant = "default",
}: {
  readonly layout: ScannerTableLayout;
  readonly onLayoutChange: (layout: ScannerTableLayout) => void;
  readonly className?: string;
  readonly variant?: "default" | "public-site";
}) {
  if (variant === "public-site") {
    return (
      <PublicSiteFilterIsland
        className={className}
        aria-label="Table row layout"
      >
        <PublicSiteFilterChip
          active={layout === "multi"}
          title="Grid cards"
          onClick={() => onLayoutChange("multi")}
        >
          <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Grid
        </PublicSiteFilterChip>
        <PublicSiteFilterChip
          active={layout === "single"}
          title="Single-line rows"
          onClick={() => onLayoutChange("single")}
        >
          <AlignJustify className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Single
        </PublicSiteFilterChip>
      </PublicSiteFilterIsland>
    );
  }
  return (
    <div
      className={cn("scanner-layout-toggle", className)}
      role="group"
      aria-label="Table row layout"
    >
      <button
        type="button"
        aria-pressed={layout === "multi"}
        title="Grid cards"
        className={cn("scanner-layout-btn", layout === "multi" && "scanner-layout-btn-active")}
        onClick={() => onLayoutChange("multi")}
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
        <span>Grid</span>
      </button>
      <button
        type="button"
        aria-pressed={layout === "single"}
        title="Single-line rows"
        className={cn("scanner-layout-btn", layout === "single" && "scanner-layout-btn-active")}
        onClick={() => onLayoutChange("single")}
      >
        <AlignJustify className="h-3.5 w-3.5" aria-hidden />
        <span>Single</span>
      </button>
    </div>
  );
}
