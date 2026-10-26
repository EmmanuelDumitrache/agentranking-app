import { prisma } from "@/lib/db";
import { FEATURED_CHAIN_IDS } from "@/lib/chains";
import { mapHomeAgentRows } from "@/lib/map-home-agent-row";
import { dedupeAgentListByCluster } from "@/lib/agent-chain-list-dedupe";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
export const CHAIN_AGENT_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  clusterKey: true,
  agentURI: true,
  sapVerified: true,
  sapX402Endpoint: true,
  name: true,
  image: true,
  owner: true,
  score: true,
  hotScore: true,
  powerScore: true,
  rank: true,
  totalFeedback: true,
  isVerified: true,
  isPremiumVerified: true,
  hasDuplicateName: true,
  createdAt: true,
  stars: true,
  chain: true,
  x402Support: true,
  binanceCompatible: true,
  scoreWallet: true,
  scoreMetadata: true,
  scoreServices: true,
  scoreQuality: true,
  scorePopularity: true,
  scoreFreshness: true,
  services: { select: { name: true, endpoint: true }, take: 12 },
  metadata: { select: { key: true, value: true } },
} as const;
/** Dedupe multi-chain clusters, then map to home MiniAgent shape. */
export async function mapTopByChainAgentRows<T extends { id: number; chainId: number; agentId: number; name: string }>(
  rows: T[],
) {
  const deduped = await dedupeAgentListByCluster(rows);
  return mapHomeAgentRows(deduped);
}
export async function computeTopByChainLive() {
  const publicWhere = await extendAgentWhereIndexable();
  const results = await Promise.all(
    FEATURED_CHAIN_IDS.map((chainId) =>
      prisma.agent.findMany({
        where: { AND: [publicWhere, { chainId }] },
        select: CHAIN_AGENT_SELECT,
        orderBy: [{ score: "desc" }, { id: "asc" }],
        take: 8,
      }),
    ),
  );
  const topByChain: Record<number, ReturnType<typeof mapHomeAgentRows>> = {};
  await Promise.all(
    FEATURED_CHAIN_IDS.map(async (chainId, i) => {
      const mapped = await mapTopByChainAgentRows(results[i] ?? []);
      topByChain[chainId] = mapped.slice(0, 5);
    }),
  );
  return { topByChain };
}
