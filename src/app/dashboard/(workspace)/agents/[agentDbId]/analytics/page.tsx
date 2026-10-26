import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { redirect } from "next/navigation";
import { loadDashboardAgentAnalyticsDto } from "@/lib/dashboard/analytics-snapshot.server";
import { DashboardAnalyticsPage } from "@/components/dashboard/analytics-page";
export const dynamic = "force-dynamic";
type Props = Readonly<{ params: Promise<{ agentDbId: string }> }>;
export default async function DashboardAnalyticsPageServer({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  await requireDashboardAgentPage(id);
  const snapshot = await loadDashboardAgentAnalyticsDto(id);
  if (!snapshot) {
    redirect(`/dashboard/agents/${id}`);
  }
  return (
    <DashboardAnalyticsPage initialData={snapshot} agentDbId={id} />
  );
}
