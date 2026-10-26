import { getPublicSiteUrl } from "@/lib/site-url";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { DashboardAgentActivityFeed } from "@/components/dashboard/activity/agent-activity-feed";
import { agentPublicUrl } from "@/lib/agent-public-url";
import { loadDashboardAgentActivityDto } from "@/lib/dashboard/portfolio-activity";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ agentDbId: string }> };
export default async function DashboardHealthPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  const { agent } = await requireDashboardAgentPage(id);
  const [initialItems] = await Promise.all([
    loadDashboardAgentActivityDto(agent.id, agent.name),
  ]);
  const publicProfileHref = agentPublicUrl(getPublicSiteUrl(), agent);
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity px-4 py-3.5 sm:px-5">
          <h1 className="text-xl font-semibold tracking-tight">Health & Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recent HTTP events and operational signals for this agent.
          </p>
        </div>
      </div>
      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">Operational activity</h2>
        </div>
        <div className="px-5 py-4">
          <DashboardAgentActivityFeed
            agentDbId={id}
            publicProfileHref={publicProfileHref}
            initialItems={initialItems}
          />
        </div>
      </section>
    </div>
  );
}
