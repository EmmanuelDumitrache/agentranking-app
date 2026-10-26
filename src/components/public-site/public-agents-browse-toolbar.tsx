"use client";
import type { ReactNode } from "react";
import { Activity, Award, BadgeCheck, Coins, Search, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PublicAgentSortKey } from "@/lib/public-site/agent-browse-filters";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import { cn } from "@/lib/utils";
export type { PublicAgentSortKey } from "@/lib/public-site/agent-browse-filters";
export const PUBLIC_AGENT_SORT_OPTIONS: {
  value: PublicAgentSortKey;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "agent_rank", label: "AR Score", icon: Award },
  { value: "new", label: "New", icon: Sparkles },
  { value: "active", label: "Active", icon: Activity },
  { value: "verified", label: "Verified", icon: BadgeCheck },
  { value: "tokenized", label: "Tokenized", icon: Coins },
];
function FilterIsland({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly "aria-label"?: string;
}) {
  return (
    <fieldset
      className={cn(
        "m-0 block w-full max-w-full min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-1 [-webkit-overflow-scrolling:touch] overscroll-x-contain lg:w-auto",
        className,
      )}
      aria-label={ariaLabel}
    >
      <div className="flex w-max items-center gap-0.5">{children}</div>
    </fieldset>
  );
}
function FilterChip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
type Props = {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly sort: PublicAgentSortKey;
  readonly onSortChange: (value: PublicAgentSortKey) => void;
  readonly searchPlaceholder?: string;
  readonly searchAriaLabel?: string;
  readonly trailingActions?: ReactNode;
};
export function PublicAgentsBrowseToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  searchPlaceholder = "Search agent name or ticker…",
  searchAriaLabel = "Search agents",
  trailingActions,
}: Props) {
  return (
    <PublicSitePanel className="gap-3 p-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
        <FilterIsland aria-label="Sort agents" className="lg:shrink-0">
          {PUBLIC_AGENT_SORT_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <FilterChip
                key={option.value}
                active={sort === option.value}
                onClick={() => onSortChange(option.value)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {option.label}
              </FilterChip>
            );
          })}
        </FilterIsland>
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
