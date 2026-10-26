import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
type Props = {
  readonly id?: string;
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bordered?: boolean;
};
export function PublicSiteSection({
  id,
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  bordered = true,
}: Props) {
  return (
    <section
      id={id}
      className={cn(bordered && "border-t border-border/50", "py-10 sm:py-12", className)}
    >
      <div className="ui-page-stack">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 max-w-2xl">
            {eyebrow ? (
              <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.14em] uppercase">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
            {description ? (
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
