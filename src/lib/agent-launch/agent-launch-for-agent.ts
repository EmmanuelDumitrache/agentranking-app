import { prisma } from "@/lib/db";
import type { AgentLaunch } from "@/generated/prisma/client";
import { autoRecoverStuckAgentLaunch } from "@/lib/agent-launch/auto-recover-launch.server";


import { getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
const LAUNCH_STATUS_RANK: Record<string, number> = {
  indexed: 100,
  fee_share_pending: 80,
  token_created: 60,
  draft: 10,
};
function pickPreferredAgentLaunch(launches: AgentLaunch[]): AgentLaunch | null {
  if (launches.length === 0) return null;
  return launches.reduce((best, current) => {
    const bestRank = LAUNCH_STATUS_RANK[best.launchStatus] ?? 0;
    const currentRank = LAUNCH_STATUS_RANK[current.launchStatus] ?? 0;
    if (currentRank > bestRank) return current;
    if (currentRank < bestRank) return best;
    return current.createdAt > best.createdAt ? current : best;
  });
}
export async function loadLatestAgentLaunchForAgent(agentDbId: number) {
  if (!Number.isFinite(agentDbId) || agentDbId <= 0) {
    return null;
  }
  const network = getAgentLaunchNetwork();
  const launches = await prisma.agentLaunch.findMany({
    where: {
      network,
      OR: [{ agentDbId }, { agentId: String(agentDbId) }],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return pickPreferredAgentLaunch(launches);
}
/** Load latest launch and auto-sync if its Pump token already exists on-chain. */
export async function loadLatestAgentLaunchForAgentWithRecovery(
  agentDbId: number,
  creatorWalletHint?: string | null,
) {
  const launch = await loadLatestAgentLaunchForAgent(agentDbId);
  if (!launch) return null;
  try {
    const { launch: recovered } = await autoRecoverStuckAgentLaunch(launch, creatorWalletHint);
    return recovered;
  } catch (error) {
    console.warn(
      "[agent-launch] page-load recover skipped",
      error instanceof Error ? error.message : error,
    );
    return launch;
  }
}