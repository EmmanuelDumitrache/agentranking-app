"use client";

import { DashboardPrivyProvider } from "@/providers/dashboard-privy-provider";
import { DashboardWalletProvider } from "@/providers/dashboard-wallet-provider";
import { QueryProvider } from "@/providers/query-provider";
import { SessionProvider } from "@/providers/session-provider";

/** Providers required by the authenticated dashboard workspace only. */
export function DashboardWorkspaceProviders({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <QueryProvider>
        <DashboardPrivyProvider>
          <DashboardWalletProvider>{children}</DashboardWalletProvider>
        </DashboardPrivyProvider>
      </QueryProvider>
    </SessionProvider>
  );
}
