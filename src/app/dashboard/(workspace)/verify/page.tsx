import { Suspense } from "react";
import { AccountVerificationPage } from "@/components/dashboard/account-verification-page";
import { DashboardLoadingSequence } from "@/components/dashboard/dashboard-loading-sequence";
import { loadAccountVerificationPageData } from "@/lib/verification/verification-page.server";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardAccountVerifyPage() {
  await requireDashboardWorkspace();
  const session = await getCachedDashboardSession();
  const initialData = await loadAccountVerificationPageData(session);
  if (!initialData) redirect("/dashboard");

  return (
    <Suspense fallback={<DashboardLoadingSequence />}>
      <AccountVerificationPage initialData={initialData} />
    </Suspense>
  );
}
