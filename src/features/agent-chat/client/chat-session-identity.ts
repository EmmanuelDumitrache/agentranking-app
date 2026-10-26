export type AgentChatClientSessionIdentityInput = {
  agentDbId: number;
  conversationId: string | null;
  promotedConversationId: string | null;
  draftSessionKey: number;
};

/**
 * AI SDK recreates its Chat instance whenever the useChat `id` changes.
 * A draft promotion is not a conversation switch: it is the same local chat
 * session gaining a durable server id immediately before the first request.
 * Keep the client id stable for that promotion so optimistic/live messages are
 * not discarded while the URL moves from draft -> persisted conversation.
 */
export function getAgentChatClientSessionId({
  agentDbId,
  conversationId,
  promotedConversationId,
  draftSessionKey,
}: AgentChatClientSessionIdentityInput): string {
  if (!conversationId || conversationId === promotedConversationId) {
    return `agent-chat:${agentDbId}:draft:${draftSessionKey}`;
  }
  return `agent-chat:${agentDbId}:conversation:${conversationId}`;
}
