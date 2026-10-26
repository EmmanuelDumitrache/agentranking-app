import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { DashboardGithubClient } from "@/components/dashboard/modules/github-client";
import { loadDashboardGithubData } from "@/lib/dashboard/github-data.server";
import { loadDashboardGithubPushes } from "@/lib/dashboard/github-pushes.server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ agentDbId: string }> };
export default async function DashboardGithubPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  const { agent } = await requireDashboardAgentPage(id);
  const [initialData, initialPushData] = await Promise.all([
    loadDashboardGithubData(id),
    loadDashboardGithubPushes(id),
  ]);
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <DashboardGithubClient
        agentDbId={id}
        isPremiumVerified={agent.isPremiumVerified}
        initialData={initialData}
        initialPushes={initialPushData.pushes}
      />
    </div>
  );
}
