import "server-only";

import { agentPublicPath } from "@/lib/agent-public-url";
import { prisma } from "@/lib/db";
import { requireAdminOperationsSession } from "./auth.server";

export async function readAdminCustomListings() {
  await requireAdminOperationsSession();
  const agents = await prisma.agent.findMany({
    where: { isCustomListed: true },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      description: true,
      isVerified: true,
      isCustomListed: true,
      supportedTrust: true,
      createdAt: true,
      owner: true,
      chain: { select: { shortName: true, color: true } },
    },
  });
  return {
    agents: agents.map((agent) => ({
      ...agent,
      createdAt: agent.createdAt.toISOString(),
      profilePath: agentPublicPath(agent),
    })),
  };
}
