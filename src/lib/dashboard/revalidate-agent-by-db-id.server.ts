import "server-only";

import { prisma } from "@/lib/db";
import { revalidateAgentPublicCache } from "@/lib/revalidate-agent-public-cache";

export async function revalidateAgentByDbId(agentDbId: number): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { chainId: true, agentId: true, name: true },
  });
  if (!agent) return;
  await revalidateAgentPublicCache(agent.chainId, agent.agentId, agent.name);
}
