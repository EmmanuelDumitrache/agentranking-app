"use client";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Radio,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GithubLogo } from "@/components/shared/brand-icons";
import {
  groupActivityByDay,
  type PortfolioActivityCategory,
  type PortfolioActivityItem,
} from "@/lib/dashboard/portfolio-activity-shared";
import { formatPortfolioRelative } from "@/components/dashboard/portfolio/portfolio-utils";
import { DashboardActivityIngestDocs } from "@/components/dashboard/shared/activity-ingest-docs";
import { cn } from "@/lib/utils";
const CATEGORY_META: Record<
  PortfolioActivityCategory,
  { icon: LucideIcon; iconClass: string }
> = {
  analytics: { icon: BarChart3, iconClass: "text-sky-400" },
  signal: { icon: Radio, iconClass: "text-amber-400" },
  github: { icon: GithubLogo, iconClass: "text-violet-400" },
  verification: { icon: ShieldCheck, iconClass: "text-emerald-400" },
};
type Props = {
  items: PortfolioActivityItem[];
  compact?: boolean;
  neutral?: boolean;
  agentDbId?: number;
  publicProfileHref?: string | null;
};
function ActivityRow({
  item,
  showAgent,
  compact,
  neutral,
}: {
  item: PortfolioActivityItem;
  showAgent: boolean;
  compact?: boolean;
  neutral?: boolean;
}) {
  const meta = CATEGORY_META[item.category];
  const Icon = meta.icon;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30",
          compact && "h-6 w-6",
        )}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            neutral ? "text-muted-foreground" : meta.iconClass,
            compact && "h-3 w-3",
          )}
          aria-hidden
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm text-foreground/90 leading-snug", compact && "text-xs")}>
          {item.label}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {showAgent ? (
            <Link
              href={`/dashboard/agents/${item.agentId}/analytics`}
              className="font-medium text-foreground/70 hover:text-primary hover:underline"
            >
              {item.agentName}
            </Link>
          ) : null}
          <span>{formatPortfolioRelative(item.at)}</span>
        </div>
      </div>
    </li>
  );
}
export function DashboardActivityPanel({
  items,
  compact = false,
  neutral = false,
  agentDbId,
  publicProfileHref,
}: Props) {
  const showAgent = !compact && !agentDbId;
  const groups = groupActivityByDay(items);
  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
          <Activity className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <p className="mt-3 text-sm font-medium">No activity yet</p>
          <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
            Activity appears when visitors view your agent profile, click services or links, when
            health checks run, or when DevProof syncs.
          </p>
          {publicProfileHref ? (
            <Link
              href={publicProfileHref}
              target="_blank"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              View public profile
            </Link>
          ) : null}
        </div>
        <details className="rounded-lg border border-border/60 bg-muted/10">
          <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">
            Advanced: HTTP ingestion (coming soon)
          </summary>
          <div className="border-t border-border/60 p-4">
            <DashboardActivityIngestDocs agentDbId={agentDbId} />
          </div>
        </details>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl border border-border bg-card", compact ? "p-3" : "p-4")}>
        {groups.map((group) => (
          <section key={group.dayKey} className="not-last:border-b not-last:border-border/50 not-last:pb-4 not-last:mb-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {group.dayLabel}
            </h3>
            <ul>
              {group.items.map((item) => (
                <ActivityRow
                  key={item.id}
                  item={item}
                  showAgent={showAgent}
                  compact={compact}
                  neutral={neutral}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <details className="rounded-lg border border-border/60 bg-muted/10">
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">
          Advanced: HTTP ingestion (coming soon)
        </summary>
        <div className="border-t border-border/60 p-4">
          <DashboardActivityIngestDocs agentDbId={agentDbId} />
        </div>
      </details>
    </div>
  );
}
