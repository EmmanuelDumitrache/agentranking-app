import type { Session } from "next-auth";
import { buildOwnedAgentsWhere } from "@/lib/dashboard/agent-ownership";
import { ensureAppAccountForProfile } from "@/lib/custodial-wallet/bootstrap";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { prisma } from "@/lib/db";
import type { AgentChatAccess } from "../shared/contracts";
import { AgentChatAccessError } from "./access-error";
import { DEFAULT_AGENT_CHAT_SETTINGS } from "./repositories/settings";

export { AgentChatAccessError } from "./access-error";
type AuthenticatedSession = Session & { user: Session["user"] & { id: string } };
function assertSession(
  session: Session | null | undefined,
): asserts session is AuthenticatedSession {
  if (!session || typeof session.user.id !== "string") {
    throw new AgentChatAccessError(
      401,
      "UNAUTHORIZED",
      "Not authenticated",
      false,
      "SIGN_IN",
    );
  }
}
export async function getAgentChatAccess(
  session: Session | null | undefined,
  agentDbId: number,
  options: { allowDisabled?: boolean } = {},
): Promise<AgentChatAccess> {
  assertSession(session);
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
  const appAccount = await ensureAppAccountForProfile({
    id: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  });
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
  if (!agent) {
    throw new AgentChatAccessError(
      404,
      "AGENT_NOT_FOUND",
      `Agent ${agentDbId} not found`,
    );
  }
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
  if (!settings.enabled && !options.allowDisabled) {
    throw new AgentChatAccessError(
      403,
      "CHAT_DISABLED",
      "Chat is disabled for this agent",
    );
  }
  return {
    appAccountId: appAccount.id,
    userProfileId: profile.id,
    agentDbId: agent.id,
    balanceCents: appAccount.llmBalanceCents,
    settings,
  };
}
