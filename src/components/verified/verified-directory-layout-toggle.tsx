"use client";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VerifiedDirectoryLayout } from "@/lib/verified-directory-layout";
export function VerifiedDirectoryLayoutToggle({
  layout,
  onLayoutChange,
  className,
}: {
  readonly layout: VerifiedDirectoryLayout;
  readonly onLayoutChange: (layout: VerifiedDirectoryLayout) => void;
  readonly className?: string;
}) {
  return (
    <div
      className={cn("scanner-layout-toggle", className)}
      role="group"
      aria-label="Directory layout"
    >
      <button
        type="button"
        aria-pressed={layout === "grid"}
        title="Grid cards"
        className={cn("scanner-layout-btn", layout === "grid" && "scanner-layout-btn-active")}
        onClick={() => onLayoutChange("grid")}
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
        <span>Grid</span>
      </button>
      <button
        type="button"
        aria-pressed={layout === "list"}
        title="Table list"
        className={cn("scanner-layout-btn", layout === "list" && "scanner-layout-btn-active")}
        onClick={() => onLayoutChange("list")}
      >
        <List className="h-3.5 w-3.5" aria-hidden />
        <span>List</span>
      </button>
    </div>
  );
}