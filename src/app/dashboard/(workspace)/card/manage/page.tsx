import { TreasuryCardDashboard } from "@/components/treasury/treasury-card-dashboard";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";

export const dynamic = "force-dynamic";

export default async function TreasuryCardPage() {
  await requireDashboardWorkspace();
  return <TreasuryCardDashboard />;
}
