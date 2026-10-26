import type { HatcherDetailPayload } from "@/lib/hatcher/types";
export type HatcherStatusFilter = "all" | "active" | "sleeping";
export type HatcherDashboardAgentRow = {
  id: number;
  chainId: number;
  agentId: number;
  name: string;
  slug: string;
  profilePath: string;
  description: string;
  score: number;
  image: string;
  owner: string;
  listedAt: string | null;
  hatcher: HatcherDetailPayload;
};
export type HatcherDashboardPayload = {
  stats: {
    indexedCount: number;
    activeCount: number;
    sleepingCount: number;
    publicChatCount: number;
    passportCount: number;
    mcpCount: number;
    totalMessages: number;
    lastIndexedAt: string | null;
  };
  agents: HatcherDashboardAgentRow[];
  agentsHasMore: boolean;
  dashboardSource?: "build-stub" | "database";
  /** Dev diagnostics when load is degraded or empty. */
};
