import "server-only";
import type { Session } from "next-auth";
import { loadAppAccountSummary } from "@/lib/app-account-summary";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";

export type DashboardAgentCreationConfigDto = {
  agentCount: number;
  maxAgents: number;
  canCreate: boolean;
  remainingSlots: number;
  walletProvisionError: string | null;
  importConfigEnabled: boolean;
  accountIsVerified: boolean;
};

export async function loadDashboardAgentCreationConfig(
  session?: Session | null,
): Promise<DashboardAgentCreationConfigDto> {
  const resolved = session === undefined ? await getCachedDashboardSession() : session;
  if (!hasDashboardSessionIdentity(resolved) || resolved?.user?.mfaVerified === false) {
    throw new Error("Unauthorized");
  }
  const summary = await loadAppAccountSummary(resolved);
  if (!summary) throw new Error("Account summary unavailable");
  const remainingSlots = Math.max(0, summary.maxAgents - summary.agentCount);
  return {
    agentCount: summary.agentCount,
    maxAgents: summary.maxAgents,
    canCreate: remainingSlots > 0,
    remainingSlots,
    walletProvisionError: summary.walletProvisionError,
    importConfigEnabled: true,
    accountIsVerified: summary.accountIsVerified,
  };
}
