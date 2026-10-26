import { prisma } from "@/lib/db";
import type {
  AgentChatScope,
  ConversationSummary,
} from "@/features/agent-chat/shared/contracts";
import { HttpError } from "../http-error";
import { MAX_ACTIVE_CONVERSATIONS_PER_AGENT } from "../../shared/constants";
import { deriveThreadTitle } from "../title";
function toSummary(conv: {
  id: string;
  title: string;
  titleSource: string;
  status: string;
  defaultModelKey: string;
  lastMessageAt: Date;
  createdAt: Date;
}): ConversationSummary {
  return {
    id: conv.id,
    title: conv.title,
    titleSource: conv.titleSource as ConversationSummary["titleSource"],
    status: conv.status,
    defaultModelKey: conv.defaultModelKey,
    lastMessageAt: conv.lastMessageAt.toISOString(),
    createdAt: conv.createdAt.toISOString(),
  };
}
export async function createConversation(
  scope: AgentChatScope,
  input: { modelKey: string; titleSeed?: string },
): Promise<ConversationSummary> {
  const activeCount = await prisma.agentChatConversation.count({
    where: {
      agentDbId: scope.agentDbId,
      appAccountId: scope.appAccountId,
      status: "ACTIVE",
    },
  });
  if (activeCount >= MAX_ACTIVE_CONVERSATIONS_PER_AGENT) {
    throw new HttpError(
      409,
      "CONVERSATION_LIMIT",
      `You can keep up to ${MAX_ACTIVE_CONVERSATIONS_PER_AGENT} chats per agent. Open an existing chat or archive one first.`,
    );
  }
  const seed = input.titleSeed?.trim() ?? "";
  const conversation = await prisma.agentChatConversation.create({
    data: {
      agentDbId: scope.agentDbId,
      appAccountId: scope.appAccountId,
      createdByUserProfileId: scope.userProfileId,
      title: seed ? deriveThreadTitle(seed) : "New chat",
      titleSource: seed ? "GENERATED" : "DEFAULT",
      defaultModelKey: input.modelKey,
    },
    select: {
      id: true,
      title: true,
      titleSource: true,
      status: true,
      defaultModelKey: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });
  return toSummary(conversation);
}

export async function getConversation(
  scope: AgentChatScope,
  conversationId: string,
): Promise<ConversationSummary> {
  const conv = await prisma.agentChatConversation.findUniqueOrThrow({
    where: {
      id: conversationId,
      appAccountId: scope.appAccountId,
      agentDbId: scope.agentDbId,
      status: { not: "DELETED" },
    },
    select: {
      id: true,
      title: true,
      titleSource: true,
      status: true,
      defaultModelKey: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });
  return toSummary(conv);
}
export async function listConversations(
  scope: AgentChatScope,
  cursor?: string,
  limit?: number,
): Promise<{ items: ConversationSummary[]; nextCursor: string | null }> {
  const take = limit ?? 20;
  let cursorValue: { lastMessageAt: Date; id: string } | undefined;
  if (cursor) {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as {
        lastMessageAt?: string;
        id?: string;
      };
      const date = new Date(decoded.lastMessageAt ?? "");
      if (!decoded.id || Number.isNaN(date.getTime()))
        throw new Error("invalid cursor");
      cursorValue = { lastMessageAt: date, id: decoded.id };
    } catch {
      throw new HttpError(
        400,
        "INVALID_MESSAGE",
        "Invalid conversation cursor",
      );
    }
  }
  const rows = await prisma.agentChatConversation.findMany({
    where: {
      appAccountId: scope.appAccountId,
      agentDbId: scope.agentDbId,
      status: { not: "DELETED" },
      ...(cursorValue
        ? {
            OR: [
              { lastMessageAt: { lt: cursorValue.lastMessageAt } },
              {
                lastMessageAt: cursorValue.lastMessageAt,
                id: { lt: cursorValue.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      title: true,
      titleSource: true,
      status: true,
      defaultModelKey: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return {
    items: items.map(toSummary),
    nextCursor: hasMore
      ? Buffer.from(
          JSON.stringify({
            lastMessageAt: items[items.length - 1].lastMessageAt.toISOString(),
            id: items[items.length - 1].id,
          }),
        ).toString("base64url")
      : null,
  };
}
export async function updateConversationStatus(
  scope: AgentChatScope,
  conversationId: string,
  status: "ACTIVE" | "ARCHIVED",
): Promise<ConversationSummary> {
  const conversation = await prisma.agentChatConversation.update({
    where: {
      id: conversationId,
      appAccountId: scope.appAccountId,
      agentDbId: scope.agentDbId,
      status: { not: "DELETED" },
    },
    data: { status, deletedAt: null },
  });
  return toSummary(conversation);
}
export async function softDeleteConversation(
  scope: AgentChatScope,
  conversationId: string,
): Promise<void> {
  await prisma.agentChatConversation.update({
    where: {
      id: conversationId,
      appAccountId: scope.appAccountId,
      agentDbId: scope.agentDbId,
    },
    data: {
      status: "DELETED",
      deletedAt: new Date(),
    },
  });
}
export async function renameConversation(
  scope: AgentChatScope,
  conversationId: string,
  title: string,
): Promise<ConversationSummary> {
  const conv = await prisma.agentChatConversation.update({
    where: {
      id: conversationId,
      appAccountId: scope.appAccountId,
      agentDbId: scope.agentDbId,
    },
    data: {
      title,
      titleSource: "USER",
    },
    select: {
      id: true,
      title: true,
      titleSource: true,
      status: true,
      defaultModelKey: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });
  return toSummary(conv);
}
