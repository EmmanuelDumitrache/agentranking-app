import "server-only";

import { redirect } from "next/navigation";
import type { DashboardAccessState } from "@/lib/dashboard/access";
import {
  appLoginUrl,
  appMfaUrl,
  DEFAULT_APP_POST_LOGIN_PATH,
} from "@/lib/app-auth-routes";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";
import { resolveDashboardAgentSolanaRegistered } from "@/lib/dashboard/agent-registration-display";
import {
  getCachedDashboardAccess,
  getCachedDashboardSession,
} from "@/lib/dashboard/server-request";
import {
  canAccessDeveloperPreviewSection,
  type DeveloperPreviewSection,
} from "@/lib/dashboard/developer-preview";

function serializeOwnedAgents(access: DashboardAccessState): DashboardAgentSummary[] {
  return access.ownedAgents.map((agent) => ({
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    image: agent.image,
    score: agent.score,
    protocolTrustScore: agent.protocolTrustScore,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    arVerificationStatus: agent.arVerificationStatus,
    description: agent.description,
    chatEnabled: agent.chatSettings?.currentRevision?.enabled ?? true,
    isSolanaRegistered: resolveDashboardAgentSolanaRegistered(agent),
  }));
}

export async function requireDashboardWorkspace(): Promise<{
  access: DashboardAccessState;
  ownedAgents: DashboardAgentSummary[];
}> {
  const access = await getCachedDashboardAccess();
  const authCallback = DEFAULT_APP_POST_LOGIN_PATH;
  if (!access.signedIn) {
    redirect(appLoginUrl(authCallback));
  }
  const session = await getCachedDashboardSession();
  if (session?.user && session.user.mfaVerified === false) {
    redirect(appMfaUrl(authCallback));
  }
  return {
    access,
    ownedAgents: serializeOwnedAgents(access),
  };
}

export async function requireDashboardAgentPage(agentDbId: number): Promise<{
  access: DashboardAccessState;
  ownedAgents: DashboardAgentSummary[];
  agent: DashboardAgentSummary;
}> {
  const workspace = await requireDashboardWorkspace();
  const agent = workspace.ownedAgents.find((row) => row.id === agentDbId);
  if (!agent) {
    redirect("/dashboard");
  }
  return {
    access: workspace.access,
    ownedAgents: workspace.ownedAgents,
    agent,
  };
}

/** Gate preview-only workspace routes (card, swap, leverage, copy trade). */
export async function requireDeveloperPreviewSection(
  _section: DeveloperPreviewSection,
): Promise<void> {
  await requireDashboardWorkspace();
  const session = await getCachedDashboardSession();
  if (!canAccessDeveloperPreviewSection(session?.user?.email)) {
    redirect("/dashboard");
  }
}
