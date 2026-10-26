"use client";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { SapListingChip } from "@/components/agents/sap-tag";
import { XonaMark } from "@/components/partners/xona-brand";
import { ARCHETYPES } from "@/lib/archetype-classifier";
import { ALL_SOCIAL_PLATFORMS_CSV, SOCIAL_FILTER_OPTIONS } from "@/lib/agent-social-filter";
import {
  DIRECTORY_CATEGORY_CHIPS,
  DIRECTORY_MODE_CHIPS,
  DIRECTORY_PRIMARY_CHIPS,
  DIRECTORY_SORT_OPTIONS,
  DIRECTORY_SOURCE_CHIPS,
  countDirectoryActiveFiltersFromDraft,
  isChipActiveInDraft,
  toggleChipInDraft,
  type DirectoryChip,
} from "@/lib/agent-directory/filters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
function ChipSection({
  title,
  description,
  chips,
  draft,
  onDraftReplace,
  scrollable = false,
}: {
  readonly title: string;
  readonly description?: string;
  readonly chips: readonly DirectoryChip[];
  readonly draft: Record<string, string>;
  onDraftReplace: (draft: Record<string, string>) => void;
  readonly scrollable?: boolean;
}) {
  return (
    <section className="agent-directory-drawer-section">
      <div className="agent-directory-drawer-section-head">
        <h3 className="agent-directory-drawer-section-title">{title}</h3>
        {description ? (
          <p className="agent-directory-drawer-section-desc">{description}</p>
        ) : null}
      </div>
      <div
        className={cn(
          "agent-directory-drawer-chip-grid",
          scrollable && "agent-directory-drawer-chip-grid--scroll",
        )}
      >
        {chips.map((chip) => {
          const active = isChipActiveInDraft(chip, draft);
          return (
            <button
              key={chip.id}
              type="button"
              className={cn(
                "agent-directory-drawer-chip",
                active && "agent-directory-drawer-chip--active",
              )}
              onClick={() => onDraftReplace(toggleChipInDraft(chip, draft))}
              aria-pressed={active}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
function SelectField({
  label,
  value,
  onValueChange,
  children,
}: {
  readonly label: string;
  readonly value: string;
  onValueChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <label className="agent-directory-drawer-field">
      <span>{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="agent-directory-drawer-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  );
}
export function AgentAdvancedFiltersDrawer({
  open,
  onOpenChange,
  chains,
  draft,
  onDraftChange,
  onDraftReplace,
  onApply,
  onClear,
  sortOptions = DIRECTORY_SORT_OPTIONS,
  defaultSortValue = "agent_rank_desc",
}: {
  readonly open: boolean;
  onOpenChange: (open: boolean) => void;
  readonly chains: Array<{ chainId: number; name: string; isActive: boolean }>;
  readonly draft: Record<string, string>;
  onDraftChange: (key: string, value: string) => void;
  onDraftReplace: (draft: Record<string, string>) => void;
  onApply: () => void;
  onClear: () => void;
  readonly sortOptions?: ReadonlyArray<{ value: string; label: string }>;
  readonly defaultSortValue?: string;
}) {
  const activeCount = countDirectoryActiveFiltersFromDraft(draft);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="agent-directory-drawer w-full gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="agent-directory-drawer-header">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 space-y-1">
              <SheetTitle className="text-base">Filters</SheetTitle>
              <SheetDescription>
                Narrow the global agent index by capability, source, and activity.
              </SheetDescription>
            </div>
            {activeCount > 0 ? (
              <span className="agent-directory-drawer-count">{activeCount}</span>
            ) : null}
          </div>
        </SheetHeader>
        <div className="agent-directory-drawer-body">
          <ChipSection
            title="Quick filters"
            description="Common capability toggles"
            chips={DIRECTORY_PRIMARY_CHIPS}
            draft={draft}
            onDraftReplace={onDraftReplace}
          />
          <ChipSection
            title="Source"
            description="Registry and runtime origin"
            chips={DIRECTORY_SOURCE_CHIPS}
            draft={draft}
            onDraftReplace={onDraftReplace}
          />
          <ChipSection
            title="Mode"
            chips={DIRECTORY_MODE_CHIPS}
            draft={draft}
            onDraftReplace={onDraftReplace}
          />
          <ChipSection
            title="Category"
            description="Agent archetype"
            chips={DIRECTORY_CATEGORY_CHIPS}
            draft={draft}
            onDraftReplace={onDraftReplace}
            scrollable
          />
          <div className="agent-directory-drawer-divider" />
          <section className="agent-directory-drawer-section">
            <div className="agent-directory-drawer-section-head">
              <h3 className="agent-directory-drawer-section-title">Refine results</h3>
              <p className="agent-directory-drawer-section-desc">Sort order and thresholds</p>
            </div>
            <div className="agent-directory-drawer-fields-grid">
              <SelectField
                label="Sort by"
                value={draft.sort || defaultSortValue}
                onValueChange={(v) => onDraftChange("sort", v)}
              >
                {sortOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectField>
              <SelectField
                label="Chain"
                value={draft.chain || "all"}
                onValueChange={(v) => onDraftChange("chain", v === "all" ? "" : v)}
              >
                <SelectItem value="all">All chains</SelectItem>
                {chains
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <SelectItem key={c.chainId} value={String(c.chainId)}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectField>
              <SelectField
                label="Protocol"
                value={draft.service || "all"}
                onValueChange={(v) => onDraftChange("service", v === "all" ? "" : v)}
              >
                <SelectItem value="all">All protocols</SelectItem>
                <SelectItem value="MCP">MCP</SelectItem>
                <SelectItem value="A2A">A2A</SelectItem>
                <SelectItem value="OASF">OASF</SelectItem>
                <SelectItem value="WEB">WEB</SelectItem>
                <SelectItem value="CUSTOM">CUSTOM</SelectItem>
              </SelectField>
              <SelectField
                label="Min AR score"
                value={draft.minScore || "any"}
                onValueChange={(v) => onDraftChange("minScore", v === "any" ? "" : v)}
              >
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="10">10+</SelectItem>
                <SelectItem value="25">25+</SelectItem>
                <SelectItem value="50">50+</SelectItem>
              </SelectField>
              <SelectField
                label="Min reviews"
                value={draft.minFeedback || "any"}
                onValueChange={(v) => onDraftChange("minFeedback", v === "any" ? "" : v)}
              >
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="1">1+</SelectItem>
                <SelectItem value="5">5+</SelectItem>
                <SelectItem value="10">10+</SelectItem>
              </SelectField>
              <SelectField
                label="Last active"
                value={draft.active || "any"}
                onValueChange={(v) => onDraftChange("active", v === "any" ? "" : v)}
              >
                <SelectItem value="any">Any time</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="live">New listings</SelectItem>
              </SelectField>
              <SelectField
                label="Archetype"
                value={draft.archetype || "all"}
                onValueChange={(v) => onDraftChange("archetype", v === "all" ? "" : v)}
              >
                <SelectItem value="all">All types</SelectItem>
                {ARCHETYPES.filter((a) => a.slug !== "telegram").map((a) => (
                  <SelectItem key={a.slug} value={a.slug}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectField>
            </div>
          </section>
          <div className="agent-directory-drawer-checks">
            <label className="agent-directory-drawer-check">
              <Checkbox
                checked={draft.sapVerified === "true"}
                onCheckedChange={(c: boolean) => onDraftChange("sapVerified", c === true ? "true" : "")}
              />
              <SapListingChip />
              <span>SAP verified</span>
            </label>
            <label className="agent-directory-drawer-check">
              <Checkbox
                checked={draft.covenant === "true"}
                onCheckedChange={(c: boolean) => onDraftChange("covenant", c === true ? "true" : "")}
              />
              <span>Covenant runtime</span>
            </label>
            <label className="agent-directory-drawer-check">
              <Checkbox
                checked={draft.hasWallet === "true"}
                onCheckedChange={(c: boolean) => onDraftChange("hasWallet", c === true ? "true" : "")}
              />
              <span>Has wallet</span>
            </label>
            <label className="agent-directory-drawer-check">
              <Checkbox
                checked={draft.x402 === "true"}
                onCheckedChange={(c: boolean) => onDraftChange("x402", c === true ? "true" : "")}
              />
              <span>x402 payments</span>
            </label>
            <label className="agent-directory-drawer-check">
              <Checkbox
                checked={draft.xpay === "true"}
                onCheckedChange={(c: boolean) => onDraftChange("xpay", c === true ? "true" : "")}
              />
              <XonaMark size={14} className="shrink-0 opacity-90" />
              <span>Xona xPay listings</span>
            </label>
          </div>
          <section className="agent-directory-drawer-section">
            <div className="agent-directory-drawer-section-head">
              <div className="flex items-center justify-between gap-2">
                <h3 className="agent-directory-drawer-section-title">Social links</h3>
                <button
                  type="button"
                  className="agent-directory-drawer-link-btn"
                  onClick={() =>
                    onDraftChange(
                      "socials",
                      draft.socials === ALL_SOCIAL_PLATFORMS_CSV ? "" : ALL_SOCIAL_PLATFORMS_CSV,
                    )
                  }
                >
                  {draft.socials === ALL_SOCIAL_PLATFORMS_CSV ? "Clear all" : "Select all"}
                </button>
              </div>
              <p className="agent-directory-drawer-section-desc">Require all selected platforms</p>
            </div>
            <div className="agent-directory-drawer-socials">
              {SOCIAL_FILTER_OPTIONS.map(({ id, label }) => {
                const selected = (draft.socials ?? "").split(",").filter(Boolean).includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      "agent-directory-drawer-chip",
                      selected && "agent-directory-drawer-chip--active",
                    )}
                    onClick={() => {
                      const list = (draft.socials ?? "").split(",").filter(Boolean);
                      const next = list.includes(id)
                        ? list.filter((s) => s !== id)
                        : [...list, id];
                      onDraftChange("socials", next.sort().join(","));
                    }}
                    aria-pressed={selected}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
        <SheetFooter className="agent-directory-drawer-footer">
          <button
            type="button"
            onClick={onClear}
            className="agent-directory-drawer-btn agent-directory-drawer-btn--ghost"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onApply}
            className="agent-directory-drawer-btn agent-directory-drawer-btn--primary"
          >
            Apply filters
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
