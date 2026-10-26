import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly className?: string;
};

export function DashboardEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: Props) {
  return (
    <div className={cn("ui-empty-state", className)}>
      {Icon ? (
        <div className="ui-empty-state-icon" aria-hidden>
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <div className="ui-empty-state-copy">
        <p className="ui-empty-state-title">{title}</p>
        {description ? (
          <p className="ui-empty-state-description">{description}</p>
        ) : null}
      </div>
      {action ? <div className="ui-empty-state-action">{action}</div> : null}
    </div>
  );
}
