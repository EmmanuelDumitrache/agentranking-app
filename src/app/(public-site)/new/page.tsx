import { Suspense } from "react";
import { AgentNewScannerPage } from "@/components/new-scanner/agent-new-scanner-page";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { getNewAgentScannerPage } from "@/lib/new-agent-scanner/data";
export const dynamic = "force-dynamic";
export default async function NewPage() {
  const initialData = await getNewAgentScannerPage(1, 20);
  return (
    <Suspense
      fallback={
        <PublicSitePageShell fullBleed className="new-scanner-page">
          <div className="new-scanner-skeleton-page" aria-busy="true" aria-label="Loading new agents" />
        </PublicSitePageShell>
      }
    >
      <AgentNewScannerPage initialData={initialData} />
    </Suspense>
  );
}
