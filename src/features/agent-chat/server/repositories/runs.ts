import { prisma } from "@/lib/db";
import type { AgentChatRun } from "@/generated/prisma/client";
import type { AgentChatScope } from "@/features/agent-chat/shared/contracts";
export async function getRun(
  scope: AgentChatScope,
  runId: string,
): Promise<AgentChatRun | null> {
  return prisma.agentChatRun.findFirst({
    where: {
      id: runId,
      appAccountId: scope.appAccountId,
      agentDbId: scope.agentDbId,
    },
  });
}
export async function getActiveRunForConversation(
  scope: AgentChatScope,
  conversationId: string,
): Promise<AgentChatRun | null> {
  return prisma.agentChatRun.findFirst({
    where: {
      conversation: {
        id: conversationId,
        appAccountId: scope.appAccountId,
        agentDbId: scope.agentDbId,
      },
      status: { in: ["PREPARING", "RESERVED", "STREAMING"] },
    },
    orderBy: { startedAt: "desc" },
  });
}