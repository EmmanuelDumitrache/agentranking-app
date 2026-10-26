import { prisma } from "@/lib/db";
import { buildOwnedAgentsWhere } from "@/lib/dashboard/agent-ownership";
import { DEFAULT_AGENT_CHAT_SETTINGS } from "@/features/agent-chat/server/repositories/settings";
import type { AgentChatAccess } from "@/features/agent-chat/shared/contracts";

/** Worker-side access for scheduled runs (no browser session). */
export async function getAgentChatAccessForWorker(
  appAccountId: string,
  agentDbId: number,
): Promise<AgentChatAccess | null> {
  const appAccount = await prisma.appAccount.findUnique({
    where: { id: appAccountId },
    select: {
      id: true,
      userProfileId: true,
      llmBalanceCents: true,
      userProfile: {
        select: {
          id: true,
          walletAddress: true,
          solanaWallet: true,
        },
      },
    },
  });
  if (!appAccount?.userProfile) return null;

  const profile = appAccount.userProfile;
  const agent = await prisma.agent.findFirst({
    where: {
      AND: [
        { id: agentDbId },
        { isActive: true },
        {
          OR: [
            { ownerAccountId: appAccount.id },
            buildOwnedAgentsWhere({
              id: profile.id,
              walletAddress: profile.walletAddress,
              solanaWallet: profile.solanaWallet,
            }),
          ],
        },
      ],
    },
    select: {
      id: true,
      chatSettings: { select: { currentRevision: true } },
    },
  });
  if (!agent) return null;

  const revision = agent.chatSettings?.currentRevision;
  const settings = revision
    ? {
        revisionId: revision.id,
        revision: revision.revision,
        enabled: revision.enabled,
        persona: revision.persona,
        systemInstructions: revision.systemInstructions,
        greeting: revision.greeting,
      }
    : { revisionId: null, revision: 0, ...DEFAULT_AGENT_CHAT_SETTINGS };

  return {
    appAccountId: appAccount.id,
    userProfileId: appAccount.userProfileId,
    agentDbId: agent.id,
    balanceCents: appAccount.llmBalanceCents,
    settings,
  };
}
