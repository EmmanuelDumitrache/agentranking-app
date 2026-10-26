export const AGENT_CHAT_NEW_DRAFT_EVENT = "agent-chat:new-draft";

export type AgentChatNewDraftDetail = {
  agentDbId: number;
};

export function requestAgentChatNewDraft(agentDbId: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AgentChatNewDraftDetail>(AGENT_CHAT_NEW_DRAFT_EVENT, {
      detail: { agentDbId },
    }),
  );
}
