import { TreasuryAgentsDashboard } from "@/components/treasury/treasury-agents-dashboard";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";

export const dynamic = "force-dynamic";

export default async function TreasuryAgentsPage() {
  await requireDashboardWorkspace();
  return <TreasuryAgentsDashboard />;
}
