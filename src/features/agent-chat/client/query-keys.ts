/**
 * Agent Chat Query Key Factory (§18.2)
 *
 * Hierarchical keys from most general (agentDbId) to most specific (resource id).
 * Invalidating a parent key invalidates all descendants automatically via
 * TanStack Query's structural sharing.
 */
export const agentChatKeys = {
  all: ["agent-chat"] as const,
  // Agent-scoped
  agent: (agentDbId: number) =>
    [...agentChatKeys.all, "agent", agentDbId] as const,
  // Models
  models: (agentDbId: number) =>
    [...agentChatKeys.agent(agentDbId), "models"] as const,
  // Settings
  settings: (agentDbId: number) =>
    [...agentChatKeys.agent(agentDbId), "settings"] as const,
  // Conversations
  conversations: (agentDbId: number) =>
    [...agentChatKeys.agent(agentDbId), "conversations"] as const,
  conversation: (agentDbId: number, conversationId: string) =>
    [...agentChatKeys.conversations(agentDbId), conversationId] as const,
  conversationMessages: (agentDbId: number, conversationId: string) =>
    [
      ...agentChatKeys.conversation(agentDbId, conversationId),
      "messages",
    ] as const,
  // Runs
  runs: (agentDbId: number) =>
    [...agentChatKeys.agent(agentDbId), "runs"] as const,
  run: (agentDbId: number, runId: string) =>
    [...agentChatKeys.runs(agentDbId), runId] as const,
  // Billing
  balance: () => [...agentChatKeys.all, "balance"] as const,
  depositConfig: () => [...agentChatKeys.all, "deposits", "config"] as const,
  deposits: () => [...agentChatKeys.all, "deposits"] as const,
  deposit: (depositId: string) =>
    [...agentChatKeys.deposits(), depositId] as const,
} as const;