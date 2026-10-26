import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { loadAppAccountSummary } from "@/lib/app-account-summary";
import { pickNewestOwnedAgentId } from "@/lib/dashboard/default-agent";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { getEthUsdPrice } from "@/lib/eth-price";
import { shouldShowOnboarding } from "@/lib/onboarding";
import { getSolUsdPrice } from "@/lib/solana-price";

export async function DashboardAuthenticatedShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const { access, ownedAgents } = await requireDashboardWorkspace();
  // First-time users must finish onboarding before the dashboard shell (sidebar) mounts.
  if (ownedAgents.length === 0 && access.profileId) {
    const needsOnboarding = await shouldShowOnboarding(access.profileId);
    if (needsOnboarding) {
      redirect("/onboarding");
    }
  }
  const session = await getCachedDashboardSession();
  const [accountSummary, solPrice, ethPrice] = await Promise.all([
    loadAppAccountSummary(session),
    getSolUsdPrice(),
    getEthUsdPrice(),
  ]);
  if (!accountSummary) {
    throw new Error("Account summary unavailable");
  }

  return (
    <DashboardShell
      ownedAgents={ownedAgents}
      selectedAgentDbId={pickNewestOwnedAgentId(ownedAgents)}
      accountSummary={accountSummary}
      solPrice={solPrice}
      ethPrice={ethPrice}
    >
      {children}
    </DashboardShell>
  );
}
