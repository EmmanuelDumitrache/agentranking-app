"use client";
import { useCallback } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAsyncResource } from "@/hooks/use-async-resource";
import type { DashboardServiceUsageDto } from "@/lib/dashboard/service-workspace.server";
type UsageRow = {
  serviceId: number;
  serviceName: string;
  serviceType: string;
  clicks: number;
};
type Props = {
  agentDbId: number;
  compact?: boolean;
  initialData?: DashboardServiceUsageDto;
};
export function DashboardServicesUsagePanel({ agentDbId, compact = false, initialData }: Props) {
  type UsagePayload = {
    analytics?: {
      totalServiceClicks: number;
      byService: UsageRow[];
      byCategory: Array<{ serviceType: string; label: string; clicks: number }>;
      days: Array<{ date: string; serviceClicks: number }>;
    };
    publicProfileHref?: string;
  };
  const load = useCallback(async (signal: AbortSignal): Promise<UsagePayload> => {
    const response = await fetch(`/api/dashboard/agents/${agentDbId}/services/analytics`, { signal });
    if (!response.ok) throw new Error("Failed to load service usage");
    return (await response.json()) as UsagePayload;
  }, [agentDbId]);
  const resourceKey = `service-usage:${agentDbId}`;
  const { data, loading } = useAsyncResource(resourceKey, load, {
    initialData,
    initialDataKey: initialData ? resourceKey : null,
    revalidateOnMount: false,
  });
  if (loading) {
    return (
      <div className="rounded-lg border border-border/60 p-4 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading service usage…
      </div>
    );
  }
  const analytics = data?.analytics;
  const total = analytics?.totalServiceClicks ?? 0;
  const byService = analytics?.byService ?? [];
  const byCategory = analytics?.byCategory ?? [];
  const maxServiceClicks = Math.max(1, ...byService.map((row) => row.clicks));
  const maxCategoryClicks = Math.max(1, ...byCategory.map((row) => row.clicks));
  return (
    <div className={cn("rounded-lg border border-border/60", compact ? "px-3 py-2" : "p-3 space-y-3")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium">Service usage (30d)</p>
          {!compact ? (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Clicks on public profile service endpoints.
            </p>
          ) : null}
        </div>
        <p className={cn("font-bold tabular-nums", compact ? "text-sm" : "text-lg")}>{total}</p>
      </div>
      {!compact && total === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/10 p-4 text-center space-y-3">
          <p className="text-xs text-muted-foreground">No service clicks yet.</p>
          {data?.publicProfileHref ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={data.publicProfileHref} target="_blank">
                View public profile
              </Link>
            </Button>
          ) : null}
        </div>
      ) : !compact ? (
        <>
          {byService.some((row) => row.clicks > 0) ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                By service
              </p>
              <ul className="space-y-1.5">
                {byService
                  .filter((row) => row.clicks > 0)
                  .map((row) => (
                    <li key={row.serviceId} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{row.serviceName}</span>
                        <span className="tabular-nums text-muted-foreground">{row.clicks}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${(row.clicks / maxServiceClicks) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {byCategory.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                By category
              </p>
              <div className="flex flex-wrap gap-2">
                {byCategory.map((row) => (
                  <div
                    key={row.serviceType}
                    className="rounded-lg border border-border/60 px-2.5 py-2 min-w-[88px]"
                  >
                    <p className="text-[10px] text-muted-foreground">{row.label}</p>
                    <p className="text-sm font-semibold tabular-nums">{row.clicks}</p>
                    <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full bg-emerald-500/70")}
                        style={{ width: `${(row.clicks / maxCategoryClicks) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
