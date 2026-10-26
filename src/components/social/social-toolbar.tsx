"use client";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SocialProfileFilter } from "@/components/social/social-types";
import { SOCIAL_FILTERS } from "@/components/social/social-types";
export function SocialToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}: {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly filter: SocialProfileFilter;
  readonly onFilterChange: (filter: SocialProfileFilter) => void;
}) {
  return (
    <div className="social-toolbar">
      <div className="social-toolbar-search-row">
        <div className="social-search-wrap">
          <Search className="social-search-icon" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search profiles, wallets, handles, agents…"
            className="social-search-input"
            aria-label="Search profiles"
          />
        </div>
      </div>
      <div className="ar-toolbar-row">
        <span className="ar-toolbar-label">Filter</span>
        <div className="social-chip-row">
          {SOCIAL_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilterChange(f.id)}
              className={cn("ar-chip social-filter-chip", filter === f.id && "ar-chip-active")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}