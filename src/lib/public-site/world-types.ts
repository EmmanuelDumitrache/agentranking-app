import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";
import type { AgentWorldCorpusTier } from "@/lib/public-site/agent-world-layout";

/** Native AgentRanking launches — always the center cluster in Agent World. */
export const AGENT_WORLD_AR_CHAIN_ID = AGENTRANKING_NATIVE_CHAIN_ID;

export type AgentWorldChainCluster = {
  readonly chainId: number;
  readonly name: string;
  readonly shortName: string;
  readonly color: string;
  readonly icon: string;
  readonly listedCount: number;
  readonly indexedCount: number;
  readonly weight: number;
  readonly href: string;
};

export type AgentWorldArCluster = AgentWorldChainCluster;

export type AgentWorldAgentPreview = {
  readonly chainId: number;
  readonly agentId: number;
  readonly name: string;
  readonly image: string;
  readonly description: string;
  readonly href: string;
  readonly score: number;
  readonly verified: boolean;
  readonly live: boolean;
  readonly registered: boolean;
  readonly x402: boolean;
  readonly listedAt: string | null;
  readonly chainShortName: string;
  readonly socials: {
    readonly twitter: string | null;
    readonly telegram: string | null;
    readonly website: string | null;
  };
};

export type AgentWorldSnapshot = {
  readonly generatedAt: string;
  /** True when FAST_LOCAL serves demo warehouse counts for UI testing. */
  readonly isMockData?: boolean;
  readonly totals: {
    readonly indexedAgents: number;
    readonly listedAgents: number;
    readonly verifiedAgents: number;
    readonly deadOrSpamAgents: number;
    readonly activeUnrankedAgents: number;
    readonly x402Agents: number;
    readonly mppAgents: number;
    readonly mcpAgents: number;
    readonly totalChains: number;
  };
  readonly chains: readonly AgentWorldChainCluster[];
  readonly arCluster: AgentWorldArCluster;
  readonly previews: readonly AgentWorldAgentPreview[];
  readonly corpusTiers: readonly AgentWorldCorpusTier[];
};

export type AgentWorldClusterAgentsResponse = {
  readonly chainId: number;
  readonly agents: readonly AgentWorldAgentPreview[];
  readonly total: number;
  readonly truncated: boolean;
};
