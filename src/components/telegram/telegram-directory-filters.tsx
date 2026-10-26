"use client";
import { Search, X, SlidersHorizontal, BadgeCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TELEGRAM_BOT_TYPES } from "@/lib/telegram/constants";
const POPULAR_TAGS = ["trading", "ai-agent", "analytics", "defi", "sniper", "memecoin"] as const;
export function TelegramDirectoryFilters({
  search,
  onSearchChange,
  botType,
  verified,
  spawnable,
  tag,
  sort,
  showFilters,
  onToggleFilters,
  activeFilterCount,
  onUpdate,
  onClear,
}: {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly botType: string;
  readonly verified: string;
  readonly spawnable: string;
  readonly tag: string;
  readonly sort: string;
  readonly showFilters: boolean;
  readonly onToggleFilters: () => void;
  readonly activeFilterCount: number;
  readonly onUpdate: (updates: Record<string, string>) => void;
  readonly onClear: () => void;
}) {
  return (
    <div className="telegram-directory-filters">
      <div className="telegram-directory-filters-row">
        <div className="telegram-directory-search-wrap">
          <Search className="telegram-directory-search-icon" aria-hidden />
          <Input
            placeholder="Search bots by name or @username…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="telegram-directory-search"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="telegram-directory-search-clear"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant={showFilters ? "default" : "outline"}
          size="sm"
          onClick={onToggleFilters}
          className="telegram-directory-filter-btn"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 ? (
            <span className="telegram-directory-filter-count">{activeFilterCount}</span>
          ) : null}
        </Button>
      </div>
      <div className="telegram-directory-chip-row">
        <button
          type="button"
          onClick={() => onUpdate({ telegramBotType: "", page: "1" })}
          className={cn("telegram-directory-chip", !botType && "telegram-directory-chip--active")}
        >
          All types
        </button>
        {TELEGRAM_BOT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() =>
              onUpdate({ telegramBotType: botType === type ? "" : type, page: "1" })
            }
            className={cn(
              "telegram-directory-chip",
              botType === type && "telegram-directory-chip--active",
            )}
          >
            {type === "managed" ? "Managed" : "Standalone"}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onUpdate({ verified: verified === "true" ? "" : "true", page: "1" })}
          className={cn(
            "telegram-directory-chip",
            verified === "true" && "telegram-directory-chip--verified",
          )}
        >
          <BadgeCheck className="h-3 w-3" />
          Verified
        </button>
        <button
          type="button"
          onClick={() =>
            onUpdate({ telegramSpawn: spawnable === "true" ? "" : "true", page: "1" })
          }
          className={cn(
            "telegram-directory-chip",
            spawnable === "true" && "telegram-directory-chip--active",
          )}
        >
          Spawnable
        </button>
        {POPULAR_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onUpdate({ tag: tag === t ? "" : t, page: "1" })}
            className={cn("telegram-directory-chip", tag === t && "telegram-directory-chip--active")}
          >
            {t}
          </button>
        ))}
        {activeFilterCount > 0 ? (
          <button type="button" onClick={onClear} className="telegram-directory-chip telegram-directory-chip--clear">
            Clear
          </button>
        ) : null}
      </div>
      {showFilters ? (
        <div className="telegram-directory-advanced">
          <label className="telegram-directory-advanced-label">
            Sort
            <Select value={sort} onValueChange={(v: string) => onUpdate({ sort: v, page: "1" })}>
              <SelectTrigger className="telegram-directory-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profile_desc">Profile quality (high → low)</SelectItem>
                <SelectItem value="created_desc">Newest</SelectItem>
                <SelectItem value="created_asc">Oldest</SelectItem>
                <SelectItem value="name_asc">Name (A → Z)</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
