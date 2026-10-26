import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { ConsoleInferenceAgentPanel } from "@/components/console/inference/console-inference-agent-panel";
import { agentPublicPath } from "@/lib/agent-public-url";
import { loadDashboardInferenceState } from "@/lib/inference-providers/dashboard-state.server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ agentDbId: string }> };

export default async function DashboardInferencePage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  const { agent } = await requireDashboardAgentPage(id);
  const initialState = await loadDashboardInferenceState(id);
  return (
    <ConsoleInferenceAgentPanel
      agentDbId={id}
      agentName={agent.name}
      publicProfilePath={agentPublicPath(agent)}
      initialState={initialState}
    />
  );
}
