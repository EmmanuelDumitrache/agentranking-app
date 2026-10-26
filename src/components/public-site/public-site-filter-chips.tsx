import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export function PublicSiteFilterIsland({
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
        "ui-public-site-filter-island m-0 inline-flex max-w-full items-center gap-0.5 overflow-x-auto p-1 [-webkit-overflow-scrolling:touch]",
        className,
      )}
      aria-label={ariaLabel}
    >
      {children}
    </fieldset>
  );
}
export function PublicSiteFilterChip({
  active,
  onClick,
  children,
  className,
  stretch,
  title,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly stretch?: boolean;
  readonly title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        stretch && "min-w-0 flex-1",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
