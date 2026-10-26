import "server-only";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { CHAINS, FEATURED_CHAIN_IDS } from "@/lib/chains";
import { getSyncableChainIds } from "@/lib/erc8004-sync";
import type { PublicNetworkSummary } from "@/lib/agent-directory/network-summaries";
const DEFAULT_CHAIN_ICON = "";
const DEFAULT_CHAIN_COLOR = "#888";
const featuredIndex = new Map(FEATURED_CHAIN_IDS.map((id, index) => [id, index]));
function compareChains(a: { chainId: number }, b: { chainId: number }): number {
  const featuredA = featuredIndex.get(a.chainId);
  const featuredB = featuredIndex.get(b.chainId);
  if (featuredA !== undefined && featuredB !== undefined) return featuredA - featuredB;
  if (featuredA !== undefined) return -1;
  if (featuredB !== undefined) return 1;
  return a.chainId - b.chainId;
}
export async function readPublicNetworkSummaries(): Promise<PublicNetworkSummary[]> {
  return withTransientPoolRetry(async () => {
    const syncableIds = new Set(getSyncableChainIds());
    const dbChains = await prisma.chain.findMany({
      select: {
        id: true,
        chainId: true,
        name: true,
        shortName: true,
        icon: true,
        color: true,
        identityRegistry: true,
        reputationRegistry: true,
        agentCount: true,
        feedbackCount: true,
      },
    });
    const dbByChainId = new Map(dbChains.map((chain) => [chain.chainId, chain]));
    return CHAINS.filter((chain) => chain.isActive)
      .sort(compareChains)
      .map((config) => {
        const db = dbByChainId.get(config.chainId);
        const chainIdText = String(config.chainId);
        return {
          id: db?.id ?? config.chainId,
          chainId: config.chainId,
          name: config.name ?? db?.name ?? `Chain ${chainIdText}`,
          shortName: config.shortName ?? db?.shortName ?? chainIdText,
          icon: config.icon || db?.icon || DEFAULT_CHAIN_ICON,
          color: config.color ?? db?.color ?? DEFAULT_CHAIN_COLOR,
          identityRegistry: config.identityRegistry ?? db?.identityRegistry ?? "",
          reputationRegistry: config.reputationRegistry ?? db?.reputationRegistry ?? "",
          agentCount: db?.agentCount ?? 0,
          feedbackCount: db?.feedbackCount ?? 0,
          isActive: config.isActive,
          isSyncable: syncableIds.has(config.chainId),
        } satisfies PublicNetworkSummary;
      });
  });
}
