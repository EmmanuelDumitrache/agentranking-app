"use client";
import {
  ArrowUpDown,
  Check,
  Coins,
  LayoutGrid,
  List,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MetaplexDirectorySort } from "@/lib/metaplex/types";
export type { MetaplexDirectorySort };
export type MetaplexDirectoryView = "grid" | "list";
export type MetaplexDirectoryFilterState = {
  search: string;
  sort: MetaplexDirectorySort;
  view: MetaplexDirectoryView;
  tradeable: boolean;
  hasServices: boolean;
  boundToken: boolean;
  active: boolean;
  registryDetected: boolean;
};
export const DEFAULT_METAPLEX_DIRECTORY_FILTERS: MetaplexDirectoryFilterState = {
  search: "",
  sort: "listed_desc",
  view: "list",
  tradeable: false,
  hasServices: false,
  boundToken: false,
  active: false,
  registryDetected: false,
};
const VIEW_STORAGE_KEY = "ar-metaplex-directory-view";
export function loadMetaplexDirectoryView(): MetaplexDirectoryView {
  if (globalThis.window === undefined) return "list";
  const v = globalThis.window.localStorage.getItem(VIEW_STORAGE_KEY);
  return v === "grid" ? "grid" : "list";
}
export function saveMetaplexDirectoryView(view: MetaplexDirectoryView): void {
  try {
    globalThis.window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // ignore
  }
}
export function countActiveMetaplexFilters(filters: MetaplexDirectoryFilterState): number {
  let n = 0;
  if (filters.tradeable) n++;
  if (filters.hasServices) n++;
  if (filters.boundToken) n++;
  if (filters.active) n++;
  if (filters.registryDetected) n++;
  return n;
}
export function clearMetaplexDirectoryFilters(
  filters: MetaplexDirectoryFilterState,
): MetaplexDirectoryFilterState {
  return {
    ...filters,
    tradeable: false,
    hasServices: false,
    boundToken: false,
    active: false,
    registryDetected: false,
  };
}
type FilterDef = {
  id: keyof Pick<
    MetaplexDirectoryFilterState,
    "tradeable" | "hasServices" | "boundToken" | "active" | "registryDetected"
  >;
  label: string;
  title: string;
  icon: typeof Coins;
};
const FILTER_DEFS: FilterDef[] = [
  {
    id: "tradeable",
    label: "Tradeable",
    title: "Trade route available: Metaplex trade URL, active launch status, or DEX pair",
    icon: Coins,
  },
  {
    id: "hasServices",
    label: "Has services",
    title: "Registration lists at least one service endpoint",
    icon: Wrench,
  },
  {
    id: "boundToken",
    label: "Bound token",
    title: "Agent token mint linked on-chain via AgentIdentity",
    icon: Sparkles,
  },
  {
    id: "active",
    label: "Active",
    title: "Marked active in Metaplex registration JSON",
    icon: Check,
  },
  {
    id: "registryDetected",
    label: "Registry detected",
    title: "AgentIdentity plugin validated on-chain",
    icon: ShieldCheck,
  },
];
function SortSegment({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none sm:min-w-[7.5rem]",
        active
          ? "bg-violet-600 text-white shadow-sm"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
function FilterToggle({
  label,
  title,
  icon: Icon,
  active,
  onClick,
}: {
  readonly label: string;
  readonly title: string;
  readonly icon: typeof Coins;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-violet-500/60 bg-violet-600/20 text-violet-100 ring-1 ring-violet-500/30"
          : "border-border/60 bg-background/40 text-muted-foreground hover:border-violet-500/30 hover:text-foreground",
      )}
    >
      <Icon className="size-3 shrink-0 opacity-80" aria-hidden />
      {label}
      {active ? <Check className="size-3 shrink-0 text-violet-300" aria-hidden /> : null}
    </button>
  );
}
function MetaplexResultSummary({
  resultTotal,
  hasSearch,
  activeFilterCount,
  resultLabel,
}: Readonly<{
  resultTotal?: number;
  hasSearch: boolean;
  activeFilterCount: number;
  resultLabel: string;
}>) {
  if (resultTotal === undefined) return null;
  if (hasSearch || activeFilterCount > 0) {
    const filterWord = activeFilterCount === 1 ? "filter" : "filters";
    return (
      <p className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
        Showing <span className="font-medium tabular-nums text-foreground">{resultTotal}</span>{" "}
        matching {resultLabel}
        {activeFilterCount > 0 ? ` · ${activeFilterCount} ${filterWord} active` : ""}
      </p>
    );
  }
  return (
    <p className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
      <span className="font-medium tabular-nums text-foreground">{resultTotal}</span>{" "}
      {resultLabel} indexed
    </p>
  );
}
export function MetaplexDirectoryFilters({
  filters,
  onChange,
  resultTotal,
  resultLabel = "agents",
}: {
  readonly filters: MetaplexDirectoryFilterState;
  readonly onChange: (next: MetaplexDirectoryFilterState) => void;
  readonly resultTotal?: number;
  readonly resultLabel?: string;
}) {
  const set = (patch: Partial<MetaplexDirectoryFilterState>) => onChange({ ...filters, ...patch });
  const activeFilterCount = countActiveMetaplexFilters(filters);
  const hasSearch = filters.search.trim().length > 0;
  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-background/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:p-3.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 rounded-lg border-border/60 bg-background/70 pl-9 pr-9 text-sm"
            placeholder="Search by name or asset address…"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
          {hasSearch ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              aria-label="Clear search"
              onClick={() => set({ search: "" })}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <fieldset className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 bg-background/60 p-0.5">
          <legend className="sr-only">View mode</legend>
          <Button
            type="button"
            size="sm"
            variant={filters.view === "grid" ? "secondary" : "ghost"}
            className={cn(
              "h-8 px-2.5",
              filters.view === "grid" && "bg-violet-600/20 text-violet-100 hover:bg-violet-600/30",
            )}
            onClick={() => {
              set({ view: "grid" });
              saveMetaplexDirectoryView("grid");
            }}
            aria-label="Grid view"
            aria-pressed={filters.view === "grid"}
          >
            <LayoutGrid className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={filters.view === "list" ? "secondary" : "ghost"}
            className={cn(
              "h-8 px-2.5",
              filters.view === "list" && "bg-violet-600/20 text-violet-100 hover:bg-violet-600/30",
            )}
            onClick={() => {
              set({ view: "list" });
              saveMetaplexDirectoryView("list");
            }}
            aria-label="List view"
            aria-pressed={filters.view === "list"}
          >
            <List className="size-4" />
          </Button>
        </fieldset>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-5">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowUpDown className="size-3" aria-hidden />
            Sort by
          </div>
          <fieldset className="inline-flex w-full max-w-md rounded-lg border border-border/60 bg-background/60 p-0.5 sm:w-auto">
            <legend className="sr-only">Sort order</legend>
            <SortSegment
              label="Latest"
              active={filters.sort === "listed_desc"}
              onClick={() =>
                set({
                  sort: "listed_desc",
                })
              }
            />
            <SortSegment
              label="Highest AR score"
              active={filters.sort === "agent_rank_desc"}
              onClick={() =>
                set({
                  sort: "agent_rank_desc",
                })
              }
            />
          </fieldset>
        </div>
        <div className="hidden w-px self-stretch bg-border/50 lg:block" aria-hidden />
        <div className="min-w-0 flex-[2] space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Filters
              {activeFilterCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-violet-600/25 px-1.5 py-px text-[9px] font-bold text-violet-200 tabular-nums">
                  {activeFilterCount}
                </span>
              ) : null}
            </span>
            {activeFilterCount > 0 ? (
              <button
                type="button"
                className="text-[11px] font-medium text-violet-400 hover:text-violet-300"
                onClick={() => onChange(clearMetaplexDirectoryFilters(filters))}
              >
                Clear filters
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_DEFS.map((def) => (
              <FilterToggle
                key={def.id}
                label={def.label}
                title={def.title}
                icon={def.icon}
                active={filters[def.id]}
                onClick={() => set({ [def.id]: !filters[def.id] })}
              />
            ))}
          </div>
        </div>
      </div>
      <MetaplexResultSummary
        resultTotal={resultTotal}
        hasSearch={hasSearch}
        activeFilterCount={activeFilterCount}
        resultLabel={resultLabel}
      />
    </div>
  );
}
export function metaplexDirectoryFiltersToParams(
  filters: MetaplexDirectoryFilterState,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams({
    metaplex: "true",
    page: String(page),
    perPage: "24",
    sort: filters.sort,
  });
  const q = filters.search.trim();
  if (q) params.set("search", q);
  if (filters.tradeable) params.set("metaplexTradeable", "true");
  if (filters.hasServices) params.set("metaplexHasServices", "true");
  if (filters.boundToken) params.set("metaplexBoundToken", "true");
  if (filters.active) params.set("metaplexActive", "true");
  if (filters.registryDetected) params.set("metaplexRegistryDetected", "true");
  return params;
}
