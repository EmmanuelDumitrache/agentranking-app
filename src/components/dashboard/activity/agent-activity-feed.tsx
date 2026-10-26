"use client";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { DashboardActivityPanel } from "@/components/dashboard/activity/activity-panel";
import {
  hydratePortfolioActivityItems,
  type PortfolioActivityItemDto,
} from "@/lib/dashboard/portfolio-activity-shared";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
type Props = {
  agentDbId: number;
  publicProfileHref: string;
  initialItems: PortfolioActivityItemDto[];
};
type ActivityPayload = { items?: PortfolioActivityItemDto[] };
export function DashboardAgentActivityFeed({
  agentDbId,
  publicProfileHref,
  initialItems,
}: Props) {
  const query = useQuery({
    queryKey: dashboardKeys.activity(agentDbId),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/dashboard/agents/${agentDbId}/activity`, {
        cache: "no-store",
        signal,
      });
      const data = response.ok ? ((await response.json()) as ActivityPayload) : null;
      return data?.items ?? [];
    },
    initialData: initialItems,
    staleTime: 0,
    refetchOnMount: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const items = hydratePortfolioActivityItems(query.data ?? initialItems);
  if (query.isPending && query.data === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="text-xs">Loading activity…</span>
      </div>
    );
  }
  return (
    <DashboardActivityPanel
      items={items}
      compact
      neutral
      agentDbId={agentDbId}
      publicProfileHref={publicProfileHref}
    />
  );
}
export default DashboardAgentActivityFeed;