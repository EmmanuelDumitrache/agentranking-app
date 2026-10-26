import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
type PageHeaderProps = {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly className?: string;
};
/** Matches dashboard pages like `/dashboard/agents/[id]/wallet`. */
export function PublicSitePageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{eyebrow}</p>
        ) : null}
        <h1 className="ui-page-title text-base sm:text-[length:var(--app-text-lg)]">{title}</h1>
        {description ? <p className="ui-page-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-header-actions shrink-0">{actions}</div> : null}
    </div>
  );
}
export function PublicSitePanel({
  children,
  className,
  dashed,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly dashed?: boolean;
}) {
  return (
    <div className={cn("ui-panel ui-panel--stack", dashed && "border-dashed", className)}>{children}</div>
  );
}
export function PublicSiteScrollRow({
  children,
  className,
  label,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">{label}</p>
      ) : null}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {children}
      </div>
    </div>
  );
}
export function PublicSiteEmptyState({
  message,
  actionHref,
  actionLabel,
}: {
  readonly message: string;
  readonly actionHref?: string;
  readonly actionLabel?: string;
}) {
  return (
    <PublicSitePanel dashed className="items-center py-8 text-center">
      <p className="ui-panel-empty">{message}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="ui-btn ui-btn-secondary ui-btn-sm ui-btn-fit">
          {actionLabel}
        </Link>
      ) : null}
    </PublicSitePanel>
  );
}
export function PublicSiteFootnote({ children }: { readonly children: ReactNode }) {
  return <p className="ui-page-footnote">{children}</p>;
}
