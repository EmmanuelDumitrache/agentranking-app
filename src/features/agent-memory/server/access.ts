import "server-only";
import type { Session } from "next-auth";
import { AgentChatAccessError } from "@/features/agent-chat/server/access-error";
import { buildOwnedAgentsWhere } from "@/lib/dashboard/agent-ownership";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { prisma } from "@/lib/db";

export type AgentMemoryAccess = {
  agentDbId: number;
  appAccountId: string;
  userProfileId: number;
};

/**
 * Authorises memory management without depending on chat enablement, LLM credit
 * state, or account-wallet provisioning. Memory is an agent-owner capability.
 */
export async function getAgentMemoryAccess(
  session: Session | null,
  agentDbId: number,
): Promise<AgentMemoryAccess> {
  if (!hasDashboardSessionIdentity(session)) {
    throw new AgentChatAccessError(
      401,
      "UNAUTHORIZED",
      "Not authenticated",
      false,
      "SIGN_IN",
    );
  }
  const profile = await getDashboardUserProfile(session);
  if (!profile) {
    throw new AgentChatAccessError(
      403,
      "FORBIDDEN",
      "User profile not found",
      false,
      "SIGN_IN",
    );
  }
  const appAccount = await prisma.appAccount.findUnique({
    where: { userProfileId: profile.id },
    select: { id: true },
  });
  if (!appAccount) {
    throw new AgentChatAccessError(
      403,
      "FORBIDDEN",
      "Dashboard account is required for agent memory",
    );
  }
  const agent = await prisma.agent.findFirst({
    where: {
      AND: [
        { id: agentDbId },
        { isActive: true },
        {
          OR: [
            ...(appAccount ? [{ ownerAccountId: appAccount.id }] : []),
            buildOwnedAgentsWhere({
              id: profile.id,
              walletAddress: profile.walletAddress,
              solanaWallet: profile.solanaWallet,
            }),
          ],
        },
      ],
    },
    select: { id: true },
  });
  if (!agent) {
    throw new AgentChatAccessError(
      404,
      "AGENT_NOT_FOUND",
      `Agent ${agentDbId} not found`,
    );
  }
  return {
    agentDbId: agent.id,
    appAccountId: appAccount.id,
    userProfileId: profile.id,
  };
}
