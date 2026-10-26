import { redirect } from "next/navigation";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ agentDbId: string }> };

export default async function DashboardAgentTradeIndexPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = /^\d+$/.test(agentDbId) ? Number(agentDbId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    redirect("/dashboard");
  }
  await requireDashboardAgentPage(id);
  redirect(`/dashboard/agents/${id}/trade/terminal`);
}
