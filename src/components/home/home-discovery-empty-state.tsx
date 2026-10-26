"use client";
import { FilterX, SearchX } from "lucide-react";
export interface HomeDiscoveryEmptyStateProps {
  title?: string;
  description?: string;
  onReset?: () => void;
  onClearChain?: () => void;
  showFilterActions?: boolean;
}
export function HomeDiscoveryEmptyState({
  title = "No agents match these filters",
  description = "Try switching to All Chains or clearing type filters.",
  onReset,
  onClearChain,
  showFilterActions = true,
}: Readonly<HomeDiscoveryEmptyStateProps>) {
  return (
    <div className="home-discovery-empty flex flex-col items-center justify-center px-4 py-10 text-center sm:py-12">
      <div className="home-discovery-empty-icon mb-3 flex h-11 w-11 items-center justify-center rounded-full">
        <SearchX className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-[var(--ar-text-primary)]">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--ar-text-muted)]">{description}</p>
      {showFilterActions && (onReset || onClearChain) ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onReset ? (
            <button type="button" className="ar-btn ar-btn-secondary !h-8 !rounded-full !px-4 !text-xs" onClick={onReset}>
              <FilterX className="h-3 w-3" aria-hidden />
              Reset filters
            </button>
          ) : null}
          {onClearChain ? (
            <button
              type="button"
              className="ar-btn ar-btn-secondary !h-8 !rounded-full !px-4 !text-xs"
              onClick={onClearChain}
            >
              Try All Chains
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}