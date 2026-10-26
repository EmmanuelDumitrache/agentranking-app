import { cn } from "@/lib/utils";

type Props = {
  readonly title: string;
  readonly description?: string;
  readonly actions?: React.ReactNode;
  readonly className?: string;
};

export function DashboardSectionHeader({
  title,
  description,
  actions,
  className,
}: Props) {
  return (
    <div className={cn("ui-section-header", className)}>
      <div className="min-w-0">
        <h2 className="ui-section-title">{title}</h2>
        {description ? <p className="ui-section-description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-section-actions">{actions}</div> : null}
    </div>
  );
}
