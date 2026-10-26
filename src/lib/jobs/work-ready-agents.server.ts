import "server-only";

import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { prisma } from "@/lib/db";
import type { PublicWorkReadyAgent } from "@/lib/jobs/work-ready-public";

export async function loadPublicWorkReadyAgents(limit = 24): Promise<PublicWorkReadyAgent[]> {
  const agents = await prisma.agent.findMany({
    where: {
      isActive: true,
      OR: [{ featuredWorkReady: true }, { workReadyStatus: "approved" }],
    },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      image: true,
      description: true,
      archetype: true,
      agentRankScore: true,
      isVerified: true,
      isPremiumVerified: true,
      featuredWorkReady: true,
      workReadyStatus: true,
      verifiedWallet: true,
      x402Support: true,
      sapX402Endpoint: true,
      sapVerified: true,
      githubConnections: { where: { status: "active" }, select: { id: true }, take: 1 },
      verificationSignals: {
        where: {
          signalType: { in: ["devproof_active", "github_verified", "wallet_verified"] },
          status: "verified",
        },
        select: { signalType: true },
        take: 5,
      },
    },
    orderBy: [{ featuredWorkReady: "desc" }, { agentRankScore: "desc" }],
    take: Math.min(50, Math.max(1, limit)),
  });

  return agents.map((agent) => ({
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    slug: toAgentUrlSlug(agent.name),
    profilePath: agentPublicPath(agent),
    image: agent.image,
    description: agent.description.slice(0, 200),
    archetype: agent.archetype,
    agentRankScore: Math.round(agent.agentRankScore),
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    featuredWorkReady: agent.featuredWorkReady,
    workReadyStatus: agent.workReadyStatus,
    hasWallet: Boolean(agent.verifiedWallet?.trim()),
    hasX402: Boolean(agent.x402Support || agent.sapX402Endpoint),
    hasOnChain: agent.sapVerified,
    hasDevProof: agent.githubConnections.length > 0,
    badges: agent.verificationSignals.map((signal) => signal.signalType),
  }));
}
