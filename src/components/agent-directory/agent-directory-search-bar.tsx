"use client";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import { cn } from "@/lib/utils";
export function AgentDirectorySearchBar({
  search,
  onSearchChange,
  filterCount,
  onOpenFilters,
}: {
  readonly search: string;
  readonly onSearchChange: (v: string) => void;
  readonly filterCount: number;
  readonly onOpenFilters: () => void;
}) {
  return (
    <PublicSitePanel className="gap-3 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <button
          type="button"
          onClick={onOpenFilters}
          className={cn(
            "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 text-xs font-medium transition-colors",
            filterCount > 0
              ? "text-foreground"
              : "text-muted-foreground hover:border-border hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Filters
          {filterCount > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-foreground px-1 text-[10px] font-semibold text-background tabular-nums">
              {filterCount}
            </span>
          ) : null}
        </button>
        <div className="relative min-w-0 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search agents, protocols, wallets, tags…"
            className="h-10 w-full rounded-lg border border-border/60 bg-muted/20 pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-border transition-colors"
            aria-label="Search agents"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </PublicSitePanel>
  );
}
