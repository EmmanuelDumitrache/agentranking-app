"use client";

import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DashboardDevBuildBadge({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-amber-400/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200",
        className,
      )}
    >
      Dev build
    </span>
  );
}

export function DashboardNavDevPill({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "ui-nav-preview-pill ui-nav-preview-pill--dev ml-auto shrink-0",
        className,
      )}
    >
      Dev
    </span>
  );
}

export function DashboardNavLockedAffordance({ className }: { readonly className?: string }) {
  return (
    <Lock
      className={cn("ui-nav-preview-lock ml-auto size-3.5 shrink-0 opacity-55", className)}
      aria-hidden
    />
  );
}

export function DashboardNavComingSoonTooltip({
  children,
  side = "right",
}: {
  readonly children: ReactNode;
  readonly side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="text-xs">
        Coming soon
      </TooltipContent>
    </Tooltip>
  );
}
