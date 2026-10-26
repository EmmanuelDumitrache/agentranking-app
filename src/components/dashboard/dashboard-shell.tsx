"use client";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";
import type { AppAccountSummary } from "@/lib/app-account-summary";
import { parseDashboardAgentDbIdFromPath } from "@/lib/dashboard/navigation";
import { DashboardAccountTopBar } from "@/components/dashboard/account-top-bar";
import { DashboardAgentSwitchOverlay } from "@/components/dashboard/agent-switch-overlay";
import { DashboardMainWaveBackground } from "@/components/dashboard/main-wave-background";
import { DashboardMobileNav } from "@/components/dashboard/mobile-nav";
import { DashboardNavigationProgress } from "@/components/dashboard/dashboard-navigation-progress";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardSkipLink } from "@/components/dashboard/dashboard-skip-link";
type PendingAgentSwitch = {
  readonly id: number;
  readonly name: string;
};
type Props = {
  readonly ownedAgents: DashboardAgentSummary[];
  readonly selectedAgentDbId: number | null;
  readonly accountSummary: AppAccountSummary;
  readonly solPrice: number | null;
  readonly ethPrice: number | null;
  readonly children: React.ReactNode;
};
export function DashboardShell({
  ownedAgents,
  selectedAgentDbId,
  accountSummary,
  solPrice,
  ethPrice,
  children,
}: Props) {
  const pathname = usePathname() ?? "";
  const pathAgentId = parseDashboardAgentDbIdFromPath(pathname);
  const effectiveSelectedAgentDbId = pathAgentId ?? selectedAgentDbId;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<PendingAgentSwitch | null>(null);
  const { data: verificationData } = useQuery({
    queryKey: dashboardKeys.accountVerification(),
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/verification/account", { signal });
      const body = (await res.json()) as { isVerified?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load verification");
      return body;
    },
    staleTime: 30_000,
  });
  const accountIsVerified =
    verificationData?.isVerified ?? accountSummary.accountIsVerified;
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  const beginAgentSwitch = useCallback(
    (agent: Pick<DashboardAgentSummary, "id" | "name">) => {
      if (pathAgentId === agent.id) return;
      setPendingSwitch({ id: agent.id, name: agent.name });
    },
    [pathAgentId],
  );
  const activePendingSwitch = pendingSwitch?.id === pathAgentId ? null : pendingSwitch;
  // Safety valve if navigation stalls
  useEffect(() => {
    if (activePendingSwitch == null) return;
    const timer = globalThis.setTimeout(() => setPendingSwitch(null), 12_000);
    return () => globalThis.clearTimeout(timer);
  }, [activePendingSwitch]);
  return (
    <div
      className="app-surface ui-app relative min-h-screen"
    >
      <DashboardSkipLink />
      <DashboardMainWaveBackground />
      <div className="relative z-10 flex">
        {/* Sidebar — sticky so it stays visible while scrolling */}
        <DashboardSidebar
          ownedAgents={ownedAgents}
          selectedAgentDbId={effectiveSelectedAgentDbId}
          maxAgents={accountSummary.maxAgents}
          accountSummary={accountSummary}
          accountIsVerified={accountIsVerified}
          onAgentSwitch={beginAgentSwitch}
        />
        {/* Main content area — offset by sidebar width on desktop */}
        <div className="ui-dashboard-shell-stage relative flex min-h-screen min-w-0 flex-1 flex-col">
          <div className="ui-dashboard-shell-stage relative z-10 flex flex-1 flex-col">
            <DashboardNavigationProgress />
            {/* Top bar — full width within main area */}
            <DashboardAccountTopBar
              initialSummary={accountSummary}
              ownedAgents={ownedAgents}
              selectedAgentDbId={effectiveSelectedAgentDbId}
              accountIsVerified={accountIsVerified}
              solPrice={solPrice}
              ethPrice={ethPrice}
              onMobileMenuClick={() => setMobileMenuOpen(true)}
            />
            {/* Mobile nav drawer (overlay only — no bar) */}
            <DashboardMobileNav
              ownedAgents={ownedAgents}
              selectedAgentDbId={effectiveSelectedAgentDbId}
              maxAgents={accountSummary.maxAgents}
              accountSummary={accountSummary}
              accountIsVerified={accountIsVerified}
              open={mobileMenuOpen}
              onClose={closeMobileMenu}
              onAgentSwitch={beginAgentSwitch}
            />
            {/* Page content */}
            <main id="dashboard-main-content" className="ui-main ui-page relative flex-1" tabIndex={-1}>
              {children}
              {activePendingSwitch ? (
                <DashboardAgentSwitchOverlay agentName={activePendingSwitch.name} />
              ) : null}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}