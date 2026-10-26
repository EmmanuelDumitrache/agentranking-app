import { cn } from "@/lib/utils";

type Props = {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: React.ReactNode;
  readonly className?: string;
};

export function DashboardPageHeader({
  title,
  subtitle,
  actions,
  className,
}: Props) {
  return (
    <header className={cn("ui-page-header", className)}>
      <div className="min-w-0">
        <h1 className="ui-page-title">{title}</h1>
        {subtitle ? <p className="ui-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
    </header>
  );
}
