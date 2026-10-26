import { prisma } from "@/lib/db";
import type { AgentChatScope } from "@/features/agent-chat/shared/contracts";
import type { AgentChatUIMessage } from "../../shared/ui-message";
import {
  validatePersistedAgentChatMessage,
  validatePersistedAgentChatMessages,
} from "../persisted-ui-message";

export async function getCanonicalUserMessage(
  scope: AgentChatScope,
  conversationId: string,
  messageId: string,
): Promise<AgentChatUIMessage | null> {
  const row = await prisma.agentChatMessage.findFirst({
    where: {
      id: messageId,
      conversationId,
      role: "user",
      conversation: {
        appAccountId: scope.appAccountId,
        agentDbId: scope.agentDbId,
        status: "ACTIVE",
      },
    },
    select: {
      id: true,
      role: true,
      parts: true,
      metadata: true,
    },
  });
  if (!row) return null;
  return validatePersistedAgentChatMessage(row);
}

export async function getConversationMessages(
  scope: AgentChatScope,
  conversationId: string,
  beforeSequence?: number,
  limit?: number,
): Promise<{ messages: AgentChatUIMessage[]; previousCursor: number | null }> {
  const take = limit ?? 50;
  const rows = await prisma.agentChatMessage.findMany({
    where: {
      conversation: {
        id: conversationId,
        appAccountId: scope.appAccountId,
        agentDbId: scope.agentDbId,
      },
      ...(beforeSequence !== undefined
        ? { sequence: { lt: beforeSequence } }
        : {}),
    },
    orderBy: { sequence: "desc" },
    take: take + 1,
    select: {
      id: true,
      role: true,
      parts: true,
      metadata: true,
      sequence: true,
    },
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const messages = await validatePersistedAgentChatMessages(page.reverse());

  return {
    messages,
    previousCursor: hasMore ? page[page.length - 1]!.sequence : null,
  };
}
