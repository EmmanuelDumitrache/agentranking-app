import "server-only";

import { CHAINS } from "@/lib/chains";
import { ARC_TESTNET_CHAIN_ID, SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { buildAgentsIndexHref } from "@/lib/ranking/agents-index-href";
import { buildCorpusTiers } from "@/lib/public-site/agent-world-layout";
import { synthesizeWorldDotPreview } from "@/lib/public-site/world-dot-preview";
import {
  AGENT_WORLD_AR_CHAIN_ID,
  type AgentWorldAgentPreview,
  type AgentWorldSnapshot,
} from "@/lib/public-site/world-types";

/** Representative chain counts for local FAST_LOCAL demos (not production data). */
const MOCK_AR_LAUNCHED_COUNT = 842;
const MOCK_PREVIEWS_PER_CLUSTER = 36;
/** Agents revealed when hovering a chain cluster in local mock mode. */
export const MOCK_CLUSTER_AGENTS_COUNT = 84;
const MOCK_CHAIN_LISTED_COUNTS: ReadonlyArray<{ readonly chainId: number; readonly listedCount: number }> = [
  { chainId: ARC_TESTNET_CHAIN_ID, listedCount: 42_180 },
  { chainId: 56, listedCount: 38_920 },
  { chainId: 8453, listedCount: 12_640 },
  { chainId: 1, listedCount: 9_850 },
  { chainId: 45056, listedCount: 4_210 },
  { chainId: 2741, listedCount: 2_980 },
  { chainId: 4326, listedCount: 2_410 },
  { chainId: 143, listedCount: 2_180 },
  { chainId: 42220, listedCount: 1_960 },
  { chainId: 42161, listedCount: 1_240 },
  { chainId: SOLANA_CHAIN_ID, listedCount: 980 },
  { chainId: 137, listedCount: 720 },
  { chainId: 43114, listedCount: 640 },
  { chainId: 10, listedCount: 510 },
  { chainId: 100, listedCount: 420 },
  { chainId: 2046399126, listedCount: 380 },
  { chainId: 5000, listedCount: 140 },
  { chainId: 534352, listedCount: 108 },
  { chainId: 59144, listedCount: 96 },
  { chainId: 167000, listedCount: 88 },
];

type MockChainMeta = {
  readonly chainId: number;
  readonly shortName: string;
  readonly name: string;
  readonly icon: string;
  readonly listedCount: number;
};

function mockListedCountForChain(chainId: number): number {
  if (chainId === AGENT_WORLD_AR_CHAIN_ID) return MOCK_AR_LAUNCHED_COUNT;
  const row = MOCK_CHAIN_LISTED_COUNTS.find((entry) => entry.chainId === chainId);
  if (row) return row.listedCount;
  const config = CHAINS.some((chain) => chain.chainId === chainId);
  return config ? 180 + (chainId % 97) * 11 : 96;
}

function resolveMockChainMeta(chainId: number): MockChainMeta {
  if (chainId === AGENT_WORLD_AR_CHAIN_ID) {
    return {
      chainId,
      shortName: "AR",
      name: "AgentRanking",
      icon: "/ar-mark.png",
      listedCount: MOCK_AR_LAUNCHED_COUNT,
    };
  }

  const config = CHAINS.find((chain) => chain.chainId === chainId);
  return {
    chainId,
    shortName: config?.shortName ?? String(chainId),
    name: config?.name ?? `Chain ${chainId}`,
    icon: config?.icon ?? "",
    listedCount: mockListedCountForChain(chainId),
  };
}

function buildMockAgentPreview(input: MockChainMeta, index: number): AgentWorldAgentPreview {
  return synthesizeWorldDotPreview(input, index);
}

/** Rich agent list for local cluster-hover previews (not production data). */
export function buildMockClusterAgents(
  chainId: number,
  options?: { readonly limit?: number },
): { readonly agents: readonly AgentWorldAgentPreview[]; readonly total: number } {
  const limit = Math.max(1, Math.min(options?.limit ?? MOCK_CLUSTER_AGENTS_COUNT, 500));
  const chain = resolveMockChainMeta(chainId);
  const agents = Array.from({ length: limit }, (_, index) => buildMockAgentPreview(chain, index));
  return {
    agents,
    total: chain.listedCount,
  };
}

function buildMockPreviews(input: MockChainMeta): readonly AgentWorldAgentPreview[] {
  return buildMockClusterAgents(input.chainId, { limit: MOCK_PREVIEWS_PER_CLUSTER }).agents;
}

/** True when Agent World should serve demo warehouse + cluster data locally. */
export function isWorldMockEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.WORLD_USE_MOCK === "0") return false;
  return true;
}

/** Local dev cluster hover uses mock agents unless `mock=0` is passed. */
export function shouldServeMockClusterAgents(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return new URL(request.url).searchParams.get("mock") !== "0";
}

export function buildLocalAgentWorldMockSnapshot(): AgentWorldSnapshot {
  const chainCatalog = new Map(CHAINS.map((chain) => [chain.chainId, chain]));
  const maxListed = Math.max(...MOCK_CHAIN_LISTED_COUNTS.map((row) => row.listedCount), 1);

  const chains = MOCK_CHAIN_LISTED_COUNTS.map((row) => {
    const config = chainCatalog.get(row.chainId);
    const listedCount = row.listedCount;
    const indexedCount = Math.round(listedCount * 1.08);
    return {
      chainId: row.chainId,
      name: config?.name ?? `Chain ${row.chainId}`,
      shortName: config?.shortName ?? String(row.chainId),
      color: config?.color ?? "#888888",
      icon: config?.icon ?? "",
      listedCount,
      indexedCount,
      weight: listedCount / maxListed,
      href: buildAgentsIndexHref({
        query: "",
        chainId: row.chainId,
        verifiedOnly: false,
        x402Only: false,
        mppOnly: false,
      }),
    };
  });

  const listedAgents = chains.reduce((sum, chain) => sum + chain.listedCount, 0);
  const verifiedAgents = 1_842;
  const activeUnrankedAgents = 18_640;
  const deadOrSpamAgents = Math.round(listedAgents * 1.85);
  const indexedAgents = listedAgents + activeUnrankedAgents + deadOrSpamAgents;
  const arCluster = {
    chainId: AGENT_WORLD_AR_CHAIN_ID,
    name: "AgentRanking",
    shortName: "AR",
    color: "#6366f1",
    icon: "/ar-mark.png",
    listedCount: MOCK_AR_LAUNCHED_COUNT,
    indexedCount: Math.round(MOCK_AR_LAUNCHED_COUNT * 1.06),
    weight: Math.min(1, MOCK_AR_LAUNCHED_COUNT / maxListed),
    href: buildAgentsIndexHref({
      query: "",
      chainId: AGENT_WORLD_AR_CHAIN_ID,
      verifiedOnly: false,
      x402Only: false,
      mppOnly: false,
    }),
  };
  const previews = [
    ...buildMockPreviews(resolveMockChainMeta(arCluster.chainId)),
    ...chains.flatMap((chain) => buildMockPreviews(resolveMockChainMeta(chain.chainId))),
  ];

  return {
    generatedAt: new Date().toISOString(),
    isMockData: true,
    totals: {
      indexedAgents,
      listedAgents,
      verifiedAgents,
      deadOrSpamAgents,
      activeUnrankedAgents,
      x402Agents: 2_410,
      mppAgents: 980,
      mcpAgents: 4_860,
      totalChains: chains.length,
    },
    arCluster,
    chains,
    previews,
    corpusTiers: buildCorpusTiers({
      indexedAgents,
      listedAgents,
      verifiedAgents,
      deadOrSpamAgents,
      activeUnrankedAgents,
    }),
  };
}
