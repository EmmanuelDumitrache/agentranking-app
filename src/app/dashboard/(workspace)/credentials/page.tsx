import { Suspense } from "react";
import { AccountCredentialsPage } from "@/components/dashboard/account-credentials-page";
import { DashboardLoadingSequence } from "@/components/dashboard/dashboard-loading-sequence";
import { loadAccountVerificationPageData } from "@/lib/verification/verification-page.server";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardAccountCredentialsPage() {
  await requireDashboardWorkspace();
  const session = await getCachedDashboardSession();
  const initialData = await loadAccountVerificationPageData(session);
  if (!initialData) redirect("/dashboard");

  return (
    <Suspense fallback={<DashboardLoadingSequence />}>
      <AccountCredentialsPage initialData={initialData} />
    </Suspense>
  );
}
