import { notFound } from "next/navigation";
import { DashboardWalletPage } from "@/components/dashboard/wallet-page";
import { loadDashboardWalletPageData } from "@/lib/dashboard/wallet-page";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ agentDbId: string }> };

export default async function DashboardAgentWalletPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = /^\d+$/.test(agentDbId) ? Number(agentDbId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const workspace = await requireDashboardAgentPage(id);
  const session = await getCachedDashboardSession();
  const data = await loadDashboardWalletPageData(session, id, {
    nativeAgentCount: workspace.access.ownedAgents.filter(isAgentRankingNativeAgent).length,
  });
  if (!data) notFound();
  return <DashboardWalletPage initialData={data} />;
}
