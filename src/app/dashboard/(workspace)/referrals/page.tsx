import { DashboardReferralsPanel } from "@/components/dashboard/referrals-panel";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { loadDashboardReferralStats } from "@/lib/referral-dashboard";
export const dynamic = "force-dynamic";
export default async function DashboardReferralsPage() {
  await requireDashboardWorkspace();
  const initialStats = await loadDashboardReferralStats();
  return <DashboardReferralsPanel initialStats={initialStats} />;
}
