import { redirect } from "next/navigation";
import { ArCardPanel } from "@/components/treasury/ar-card-panel";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { loadTreasuryCardPageData } from "@/lib/agent-payments/treasury-card-page.server";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { getAccountVerification } from "@/lib/verification/account-verification-service";

export const dynamic = "force-dynamic";

export default async function TreasuryCardCreatePage() {
  await requireDashboardWorkspace();
  const session = await getCachedDashboardSession();
  const auth = await requireTreasurySession(session);
  if (!auth.ok) redirect("/dashboard/card");

  const verification = await getAccountVerification(auth.appAccountId);
  if (!verification?.canIssueCards) {
    redirect("/dashboard/card");
  }

  const initialData = await loadTreasuryCardPageData(session);

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 min-w-0">
      <ArCardPanel
        mode="create"
        initialData={
          initialData ? { config: initialData.config, card: null } : undefined
        }
      />
    </div>
  );
}
