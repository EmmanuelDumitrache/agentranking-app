import { TreasuryTransactionsDashboard } from "@/components/treasury/treasury-transactions-dashboard";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";

export const dynamic = "force-dynamic";

export default async function TreasuryTransactionsPage() {
  await requireDashboardWorkspace();
  return <TreasuryTransactionsDashboard />;
}
