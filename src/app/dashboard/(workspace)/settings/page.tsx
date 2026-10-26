import { Suspense } from "react";
import { DashboardLoadingSequence } from "@/components/dashboard/dashboard-loading-sequence";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { DashboardSettingsPage } from "@/components/dashboard/settings-page";
import {
  loadDashboardAccountSettings,
  loadDashboardSecurityStatus,
} from "@/lib/dashboard/account-settings.server";
import { loadDashboardSubscription } from "@/lib/dashboard/account-subscription.server";
import { loadDashboardSupportUnreadCount } from "@/lib/dashboard/account-support.server";
export const dynamic = "force-dynamic";
export default async function DashboardSettingsPageRoute() {
  const { access, ownedAgents } = await requireDashboardWorkspace();
  const [initialAccountData, initialSecurityStatus, initialSubscription, initialSupportUnread] =
    await Promise.all([
      loadDashboardAccountSettings(),
      loadDashboardSecurityStatus(),
      loadDashboardSubscription(),
      loadDashboardSupportUnreadCount(),
    ]);
  return (
    <Suspense fallback={<DashboardLoadingSequence />}>
      <DashboardSettingsPage
        ownedAgents={ownedAgents}
        accountIsVerified={access.accountIsVerified}
        initialAccountData={initialAccountData}
        initialSecurityStatus={initialSecurityStatus}
        initialSubscription={initialSubscription}
        initialSupportUnread={initialSupportUnread}
      />
    </Suspense>
  );
}
