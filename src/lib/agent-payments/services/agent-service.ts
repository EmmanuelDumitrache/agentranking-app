import { prisma } from "@/lib/db";
import { listTransactions } from "./transaction-service";

/** Agents owned by the treasury account (AppAccount). */
export async function listAccountAgents(appAccountId: string) {
  return prisma.agent.findMany({
    where: { ownerAccountId: appAccountId, isActive: true },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      image: true,
      score: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getAgentSpendSummary(appAccountId: string, agentId: number) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ownerAccountId: appAccountId },
    select: { id: true, name: true },
  });
  if (!agent) return null;

  const [spentAgg, recent] = await Promise.all([
    prisma.treasuryTransaction.aggregate({
      where: {
        appAccountId,
        agentId,
        type: "SPEND",
        status: "SETTLED",
      },
      _sum: { amountCents: true },
      _count: true,
    }),
    listTransactions({ appAccountId, agentId, limit: 20 }),
  ]);

  return {
    agent,
    totalSpentCents: spentAgg._sum.amountCents ?? 0,
    spendCount: spentAgg._count,
    recent: recent.items,
  };
}
