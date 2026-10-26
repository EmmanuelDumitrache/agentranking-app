"use client";
import { cn } from "@/lib/utils";
/** Footer / compact link — scrolls to the on-page Qwerti buy panel. */
export function BuyArTrigger({ className }: { readonly className?: string }) {
  return (
    <a
      href="#buy-ar"
      className={cn("ar-public-link-muted text-[11px] hover:text-[var(--ar-text-secondary)]", className)}
    >
      Buy $AR
    </a>
  );
}
