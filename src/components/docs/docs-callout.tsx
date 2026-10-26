import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export type DocsCalloutType = "info" | "warning" | "planned" | "token" | "developer";
export function DocsCallout({
  type = "info",
  title,
  children,
  className,
}: {
  readonly type?: DocsCalloutType;
  readonly title?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const showAccent = type === "warning" || type === "token";
  return (
    <aside className={cn("docs-callout", showAccent && "docs-callout-accent", className)}>
      {title ? <p className="docs-card-title mb-1">{title}</p> : null}
      <div>{children}</div>
    </aside>
  );
}