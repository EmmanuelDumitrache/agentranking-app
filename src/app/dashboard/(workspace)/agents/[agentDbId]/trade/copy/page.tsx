import { notFound } from "next/navigation";
import { DashboardCopyTradePage } from "@/components/dashboard/copy-trade-page";
import { loadDashboardCopyTradePageData } from "@/lib/agent-trading/copy-trade-page.server";
import { requireDashboardAgentPage, requireDeveloperPreviewSection } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ agentDbId: string }> };

export default async function DashboardAgentTradeCopyPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = /^\d+$/.test(agentDbId) ? Number(agentDbId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  await requireDashboardAgentPage(id);
  await requireDeveloperPreviewSection("trade-copy");
  const session = await getCachedDashboardSession();
  const data = await loadDashboardCopyTradePageData(session, id);
  if (!data) notFound();
  return <DashboardCopyTradePage initialData={data} />;
}
