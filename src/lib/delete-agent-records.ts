import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
async function deleteRestrictiveAgentRelations(
  tx: Prisma.TransactionClient,
  agentIds: number[],
): Promise<void> {
  if (agentIds.length === 0) return;
  const ids = { in: agentIds };
  await tx.agentAnalyticsEvent.deleteMany({ where: { agentId: ids } });
  await tx.agentRankSnapshot.deleteMany({ where: { agentId: ids } });
  await tx.agentPerfSnapshot.deleteMany({ where: { agentId: ids } });
  await tx.walletLinkChallenge.deleteMany({ where: { agentId: ids } });
  await tx.order.updateMany({ where: { agentId: ids }, data: { agentId: null } });
  await tx.bounty.updateMany({ where: { claimedByAgentId: ids }, data: { claimedByAgentId: null } });
  await tx.meshSubscription.deleteMany({
    where: {
      OR: [
        { subscriberAgentId: ids },
        { publisherAgentId: ids },
      ],
    },
  });
  await tx.trustEvent.deleteMany({ where: { agentId: ids } });
  await tx.feedback.deleteMany({ where: { agentId: ids } });
  await tx.agentService.deleteMany({ where: { agentId: ids } });
  await tx.agentMetadata.deleteMany({ where: { agentId: ids } });
  await tx.agentStar.deleteMany({ where: { agentId: ids } });
}
async function refreshChainCounts(
  tx: Prisma.TransactionClient,
  chainIds: number[],
): Promise<void> {
  for (const chainId of new Set(chainIds)) {
    const agentCount = await tx.agent.count({ where: { chainId } });
    await tx.chain.update({ where: { chainId }, data: { agentCount } });
  }
}
export type DeleteCustomListedAgentResult =
  | { status: "deleted"; chainId: number }
  | { status: "not_found" }
  | { status: "not_custom" };
export async function deleteCustomListedAgent(
  agentDbId: number,
): Promise<DeleteCustomListedAgentResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.agent.findUnique({
      where: { id: agentDbId },
      select: { chainId: true, isCustomListed: true },
    });
    if (!existing) return { status: "not_found" } as const;
    if (!existing.isCustomListed) return { status: "not_custom" } as const;
    await deleteRestrictiveAgentRelations(tx, [agentDbId]);
    await tx.agent.delete({ where: { id: agentDbId } });
    await refreshChainCounts(tx, [existing.chainId]);
    return { status: "deleted", chainId: existing.chainId } as const;
  });
}
export async function deleteAgentsMatching(
  where: Prisma.AgentWhereInput,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const matches = await tx.agent.findMany({
      where,
      select: { id: true, chainId: true },
    });
    if (matches.length === 0) return 0;
    const agentIds = matches.map((agent) => agent.id);
    await deleteRestrictiveAgentRelations(tx, agentIds);
    const deleted = await tx.agent.deleteMany({ where: { id: { in: agentIds } } });
    await refreshChainCounts(tx, matches.map((agent) => agent.chainId));
    return deleted.count;
  });
}
