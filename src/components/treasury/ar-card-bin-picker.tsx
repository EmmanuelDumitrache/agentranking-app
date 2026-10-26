"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ArCardBinOption } from "@/lib/agent-payments/providers/card/ar-card-bins";
import { cn } from "@/lib/utils";

export function arCardRegionFlag(regionCode: string): string {
  const code = regionCode.trim().toUpperCase();
  if (!code || code === "XX") return "🌐";
  if (code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return "🏳️";
  return String.fromCodePoint(
    ...[...code].map((char) => 0x1f1e6 - 65 + char.codePointAt(0)!),
  );
}

function optionTitle(option: ArCardBinOption): string {
  const network = option.network === "visa" ? "Visa" : "MasterCard";
  return `${network} — ${option.region}`;
}

function binMetaLine(option: ArCardBinOption): string {
  const parts = [`BIN ${option.bin}`];
  if (option.requiresDateOfBirth) parts.push("DOB Required");
  return parts.join(" · ");
}

function TagPills({ tags, muted = false }: { tags: string[]; muted?: boolean }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            muted
              ? "bg-muted/60 text-muted-foreground"
              : "bg-muted text-foreground",
          )}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function BinRowContent({
  option,
  compact = false,
}: {
  option: ArCardBinOption;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <span className={cn("leading-none", compact ? "text-xl" : "text-2xl")} aria-hidden>
        {arCardRegionFlag(option.regionCode)}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-[15px]")}>
            {optionTitle(option)}
          </p>
          <TagPills tags={option.tags} />
        </div>
        <p className="text-xs font-medium text-muted-foreground">{binMetaLine(option)}</p>
      </div>
    </div>
  );
}

type Props = {
  bins: ArCardBinOption[];
  selectedBin: string;
  onSelectBin: (bin: string) => void;
  className?: string;
};

export function ArCardBinPicker({ bins, selectedBin, onSelectBin, className }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = bins.find((b) => b.bin === selectedBin) ?? bins[0];

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  const pick = (bin: string) => {
    onSelectBin(bin);
    close();
  };

  if (!selected) return null;

  return (
    <div ref={rootRef} className={cn("relative space-y-1.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Card type · BIN
      </span>

      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border bg-background/80 px-3 py-3 text-left transition-colors",
          open
            ? "border-foreground/30 ring-1 ring-foreground/10"
            : "border-border hover:border-foreground/20",
        )}
      >
        <BinRowContent option={selected} compact />
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Card type options"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl shadow-black/50"
        >
          <div className="max-h-[min(360px,50vh)] overflow-y-auto p-1.5">
            {bins.map((option) => {
              const isSelected = option.bin === selectedBin;
              return (
                <button
                  key={option.bin}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => pick(option.bin)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors",
                    isSelected
                      ? "bg-muted ring-1 ring-border"
                      : "hover:bg-muted/50",
                  )}
                >
                  <BinRowContent option={option} />
                  {isSelected ? (
                    <Check className="size-4 shrink-0 text-foreground" aria-hidden />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                  )}
                </button>
              );
            })}

            <div className="my-1.5 border-t border-border/60" />
            <p className="px-2.5 py-2 text-center text-[10px] text-muted-foreground">
              More card programs coming soon
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
