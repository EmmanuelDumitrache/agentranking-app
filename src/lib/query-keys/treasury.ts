/**
 * Treasury/card subsystem Query Key Factory.
 */
export const treasuryKeys = {
  all: ["treasury"] as const,

  wallet: () => [...treasuryKeys.all, "wallet"] as const,

  walletConfig: () => [...treasuryKeys.wallet(), "config"] as const,

  walletAgents: () => [...treasuryKeys.wallet(), "agents"] as const,

  walletBalance: () => [...treasuryKeys.wallet(), "balance"] as const,

  walletTransactions: (filters: {
    limit?: number;
    merchant?: string;
    status?: string;
    category?: string;
  }) => [...treasuryKeys.wallet(), "transactions", filters] as const,

  cards: () => [...treasuryKeys.all, "cards"] as const,

  card: (cardId: string) => [...treasuryKeys.cards(), cardId] as const,

  policies: () => [...treasuryKeys.all, "policies"] as const,

  agent: (agentId: number) => [...treasuryKeys.all, "agent", agentId] as const,

  agentCard: (agentId: number) => [...treasuryKeys.agent(agentId), "card"] as const,

  agentTransactions: (agentId: number, limit: number) =>
    [...treasuryKeys.agent(agentId), "transactions", { limit }] as const,

  stripeIssuingAgent: (agentId: number) =>
    [...treasuryKeys.agent(agentId), "stripe-issuing"] as const,
} as const;