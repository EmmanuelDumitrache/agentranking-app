import { redirect } from "next/navigation";
import { AgentRegisterPage } from "@/components/dashboard/agent-register-page";
import { loadDashboardRegisterPageData } from "@/lib/agent-solana-registration/register-page.server";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";

export const dynamic = "force-dynamic";

type Props = Readonly<{ params: Promise<{ agentDbId: string }> }>;

export default async function DashboardAgentRegisterPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    redirect("/dashboard");
  }
  await requireDashboardAgentPage(id);
  const initialData = await loadDashboardRegisterPageData(id);
  if (!initialData) {
    redirect("/dashboard");
  }
  return <AgentRegisterPage initialData={initialData} />;
}
