import { DashboardWalletPage } from "@/components/dashboard/wallet-page";
import { loadDashboardWalletPageData } from "@/lib/dashboard/wallet-page";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";

export const dynamic = "force-dynamic";

export default async function DashboardAccountWalletPage() {
  const workspace = await requireDashboardWorkspace();
  const session = await getCachedDashboardSession();
  const data = await loadDashboardWalletPageData(session, null, {
    nativeAgentCount: workspace.access.ownedAgents.filter(isAgentRankingNativeAgent).length,
  });
  if (!data) {
    throw new Error("Wallet data unavailable");
  }
  return <DashboardWalletPage initialData={data} />;
}
