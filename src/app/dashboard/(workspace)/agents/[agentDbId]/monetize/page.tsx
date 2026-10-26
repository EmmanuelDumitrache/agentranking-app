import { notFound } from "next/navigation";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { DashboardMonetizationAgentEdit } from "@/components/dashboard/monetization/monetization-agent-edit";
import { agentPublicUrl } from "@/lib/agent-public-url";
import { getPublicSiteUrl } from "@/lib/site-url";
import { loadDashboardMonetizationWorkspace } from "@/lib/dashboard/x402-monetization-workspace.server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ agentDbId: string }> };

export default async function DashboardMonetizePage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  const { agent } = await requireDashboardAgentPage(id);
  const initialState = await loadDashboardMonetizationWorkspace(id);
  if (!initialState) notFound();
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <DashboardMonetizationAgentEdit
        agentDbId={id}
        agentName={agent.name}
        agentImage={agent.image ?? ""}
        publicProfileUrl={agentPublicUrl(getPublicSiteUrl(), agent)}
        initialState={initialState}
      />
    </div>
  );
}
