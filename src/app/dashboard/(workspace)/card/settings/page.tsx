import { TreasurySettingsDashboard } from "@/components/treasury/treasury-settings-dashboard";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";

export const dynamic = "force-dynamic";

export default async function TreasurySettingsPage() {
  await requireDashboardWorkspace();
  return <TreasurySettingsDashboard />;
}
