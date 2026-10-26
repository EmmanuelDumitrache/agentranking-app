/** Starter prompts shown in the empty chat welcome — AgentRanking product surface. */

export type AgentChatStarterPrompt = {
  id: string;
  label: string;
};

export function getAgentChatStarterPrompts(
  agentName?: string | null,
): AgentChatStarterPrompt[] {
  const name = agentName?.trim() || "this agent";
  return [
    {
      id: "wallet",
      label: "Show my Solana wallet address and balances.",
    },
    {
      id: "send-demo",
      label: "Help me send a tiny amount of SOL.",
    },
    {
      id: "transfers",
      label: "Show my recent wallet transfers.",
    },
    {
      id: "profile",
      label: `Summarize ${name}'s AgentRanking profile.`,
    },
  ];
}
