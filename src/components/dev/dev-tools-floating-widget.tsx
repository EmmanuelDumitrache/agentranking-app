"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
};

export function DevToolsFloatingWidget({ title, subtitle, children, className }: Props) {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();

  if (!hydrated) return null;

  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed bottom-5 right-5 z-[200] flex flex-col items-end gap-2",
        className,
      )}
      aria-live="polite"
    >
      {open ? (
        <div
          className="pointer-events-auto w-[min(100vw-2.5rem,22rem)] overflow-hidden rounded-xl border border-amber-400/35 bg-[#1a1a1a] shadow-2xl shadow-black/50"
          role="dialog"
          aria-label={title}
        >
          <div className="flex items-start justify-between gap-3 border-b border-amber-400/20 bg-amber-500/10 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{title}</p>
              {subtitle ? (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
              aria-label="Close dev tools"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="max-h-[min(70vh,32rem)] overflow-y-auto p-3">{children}</div>
        </div>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="pointer-events-auto h-9 gap-1.5 rounded-full border border-amber-400/35 bg-[#212121] px-3 shadow-lg shadow-black/40"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close dev tools" : "Open dev tools"}
      >
        <Wrench className="size-3.5 text-amber-400" aria-hidden />
        <span className="text-xs font-medium">Dev</span>
      </Button>
    </div>,
    document.body,
  );
}
