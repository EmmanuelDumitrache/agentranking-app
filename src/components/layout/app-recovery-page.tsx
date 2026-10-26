import Link from "next/link";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { cn } from "@/lib/utils";
export function AppRecoveryPage({
  code,
  title,
  description,
  detail,
  actions,
  className,
}: {
  readonly code?: string;
  readonly title: string;
  readonly description: string;
  readonly detail?: string;
  readonly actions: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("app-recovery-page ar-surface", className)}>
      <div className="app-recovery-card">
        <div className="app-recovery-brand">
          <AgentRankingWordmark size="default" priority />
        </div>
        {code ? <p className="app-recovery-code">{code}</p> : null}
        <h1 className="app-recovery-title">{title}</h1>
        <p className="app-recovery-desc">{description}</p>
        {detail ? (
          <pre className="app-recovery-detail">{detail}</pre>
        ) : null}
        <div className="app-recovery-actions">{actions}</div>
      </div>
    </div>
  );
}
export function AppRecoveryLink({
  href,
  children,
  primary = false,
  className,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
  readonly primary?: boolean;
  readonly className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        primary ? "ar-btn ar-btn-primary" : "ar-btn ar-btn-secondary",
        className,
      )}
    >
      {children}
    </Link>
  );
}