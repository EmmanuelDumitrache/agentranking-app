import { Suspense } from "react";
import { DashboardAuthenticatedShell } from "@/components/dashboard/authenticated-shell";
import { DashboardPageSkeleton } from "@/components/dashboard/page-skeleton";
import { DashboardScope } from "@/components/dashboard/dashboard-scope";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardWorkspaceProviders } from "@/providers/dashboard-workspace-providers";

export const dynamic = "force-dynamic";

export default function DashboardWorkspaceLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <DashboardScope>
      <DashboardWorkspaceProviders>
        <Suspense fallback={<DashboardPageSkeleton />}>
          <TooltipProvider>
            <DashboardAuthenticatedShell>{children}</DashboardAuthenticatedShell>
          </TooltipProvider>
        </Suspense>
      </DashboardWorkspaceProviders>
    </DashboardScope>
  );
}
