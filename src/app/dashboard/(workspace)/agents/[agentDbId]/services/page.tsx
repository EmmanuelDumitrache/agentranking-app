import { notFound } from "next/navigation";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { DashboardServicesAgentEdit } from "@/components/dashboard/services/services-agent-edit";
import { agentPublicUrl } from "@/lib/agent-public-url";
import { getPublicSiteUrl } from "@/lib/site-url";
import { loadDashboardServicesWorkspace } from "@/lib/dashboard/service-workspace.server";
import { getMcpOffers } from "@/lib/agent-mcp-offers";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ agentDbId: string }> };

export default async function DashboardServicesPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  const { agent } = await requireDashboardAgentPage(id);
  const [initialState, initialMcpOffers] = await Promise.all([
    loadDashboardServicesWorkspace(id),
    getMcpOffers(id, { includeUnpublished: true }),
  ]);
  if (!initialState) notFound();
  return (
    <DashboardServicesAgentEdit
      agentDbId={id}
      agentName={agent.name}
      agentImage={agent.image ?? ""}
      publicProfileUrl={agentPublicUrl(getPublicSiteUrl(), agent)}
      initialState={initialState}
      initialMcpOffers={initialMcpOffers}
    />
  );
}
