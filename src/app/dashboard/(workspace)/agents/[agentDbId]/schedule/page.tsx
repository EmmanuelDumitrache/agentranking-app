import { redirect } from "next/navigation";
import { AgentSchedulePage } from "@/components/dashboard/agent-schedule-page";
import { loadDashboardSchedulePageData } from "@/lib/agent-schedule/schedule-page.server";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";

export const dynamic = "force-dynamic";

type Props = Readonly<{ params: Promise<{ agentDbId: string }> }>;

export default async function DashboardAgentSchedulePage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    redirect("/dashboard");
  }
  await requireDashboardAgentPage(id);
  const session = await getCachedDashboardSession();
  const chatAccess = await getAgentChatAccess(session, id, { allowDisabled: true });
  const initialData = await loadDashboardSchedulePageData(id, chatAccess.appAccountId);
  return <AgentSchedulePage initialData={initialData} />;
}
