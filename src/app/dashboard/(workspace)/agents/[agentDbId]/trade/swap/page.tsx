import { notFound } from "next/navigation";
import { DashboardTradePage } from "@/components/dashboard/trade-page";
import { loadDashboardTradePageData } from "@/lib/agent-trading/trade-page.server";
import { requireDashboardAgentPage, requireDeveloperPreviewSection } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ agentDbId: string }> };

export default async function DashboardAgentTradeSwapPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = /^\d+$/.test(agentDbId) ? Number(agentDbId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  await requireDashboardAgentPage(id);
  await requireDeveloperPreviewSection("trade-swap");
  const session = await getCachedDashboardSession();
  const data = await loadDashboardTradePageData(session, id);
  if (!data) notFound();
  return <DashboardTradePage initialData={data} />;
}
