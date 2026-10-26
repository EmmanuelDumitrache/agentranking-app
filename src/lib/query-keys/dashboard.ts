/**
 * Dashboard workspace Query Key Factory.
 *
 * Hierarchical keys from most general (agentDbId) to most specific (resource).
 * Invalidating a parent key invalidates all descendants via TanStack Query's
 * partial key matching.
 */
export const dashboardKeys = {
  all: ["dashboard"] as const,

  account: () => [...dashboardKeys.all, "account"] as const,

  accountProfile: () => [...dashboardKeys.account(), "profile"] as const,

  accountVerification: () =>
    [...dashboardKeys.account(), "verification"] as const,

  accountSecurity: () => [...dashboardKeys.account(), "security"] as const,

  mcpProviders: (filters?: Record<string, unknown>) =>
    [...dashboardKeys.account(), "mcp-providers", filters ?? {}] as const,

  mcpConnections: () =>
    [...dashboardKeys.account(), "mcp-connections"] as const,

  mcpConnection: (connectionId: string) =>
    [...dashboardKeys.mcpConnections(), connectionId] as const,

  llmProviderCredentials: () =>
    [...dashboardKeys.account(), "llm-provider-credentials"] as const,

  agent: (agentDbId: number) =>
    [...dashboardKeys.all, "agent", agentDbId] as const,

  agentDetails: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "details"] as const,

  analytics: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "analytics"] as const,

  memory: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "memory"] as const,

  schedules: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "schedules"] as const,

  scheduleRuns: (agentDbId: number, scheduleId: string) =>
    [...dashboardKeys.schedules(agentDbId), scheduleId, "runs"] as const,

  activity: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "activity"] as const,

  transfers: (agentDbId: number, params?: Record<string, unknown>) =>
    [...dashboardKeys.agent(agentDbId), "transfers", params ?? {}] as const,

  wallet: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "wallet"] as const,

  walletSummary: (agentDbId: number) =>
    [...dashboardKeys.wallet(agentDbId), "summary"] as const,

  evmWallet: (agentDbId: number) =>
    [...dashboardKeys.wallet(agentDbId), "evm"] as const,

  evmActivity: (agentDbId: number) =>
    [...dashboardKeys.wallet(agentDbId), "evm-activity"] as const,

  launch: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "launch"] as const,

  claimableFees: (agentDbId: number, launchId: string) =>
    [...dashboardKeys.launch(agentDbId), "claimable-fees", launchId] as const,

  github: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "github"] as const,

  githubPushes: (agentDbId: number, snapshotCapturedAt: string | null) =>
    [...dashboardKeys.github(agentDbId), "pushes", snapshotCapturedAt] as const,

  services: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "services"] as const,

  serviceAnalytics: (agentDbId: number) =>
    [...dashboardKeys.services(agentDbId), "analytics"] as const,

  agentMcpBindings: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "mcp-bindings"] as const,

  agentMcpTools: (agentDbId: number, connectionId: string) =>
    [...dashboardKeys.agentMcpBindings(agentDbId), connectionId, "tools"] as const,

  inferenceProviders: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "inference-providers"] as const,

  copyTrade: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "copy-trade"] as const,

  copyTradeLeaderboard: (
    agentDbId: number,
    params: {
      venue: string;
      wallet: string;
      limit: number;
    },
  ) => [...dashboardKeys.copyTrade(agentDbId), "leaderboard", params] as const,

  perps: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "perps"] as const,

  terminalLog: (agentDbId: number) =>
    [...dashboardKeys.agent(agentDbId), "terminal-log"] as const,
} as const;
