import { notFound } from "next/navigation";
import { DashboardSocialModule } from "@/components/dashboard/modules/social-module";
import {
  loadDashboardAgentDetail,
  loadDashboardAgentEditorState,
} from "@/lib/dashboard/agent-detail";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ agentDbId: string }> };
export default async function DashboardSocialPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  const { agent } = await requireDashboardAgentPage(id);
  const [detail, editorState] = await Promise.all([
    loadDashboardAgentDetail(id),
    loadDashboardAgentEditorState(id),
  ]);
  if (!detail || !editorState) notFound();
  return (
    <DashboardSocialModule
      agentDbId={id}
      agentName={agent.name}
      agentImage={agent.image ?? ""}
      description={detail.agent.description ?? ""}
      archetype={detail.agent.archetype ?? ""}
      tokenAddress={detail.agent.tokenAddress ?? ""}
      initialMetadata={detail.agent.metadata}
      initialServices={detail.agent.services}
      initialResolvedLinks={editorState.links}
      initialSavedLinkTypes={editorState.savedLinkTypes}
      initialVersionManifest={editorState.versionManifest}
    />
  );
}
