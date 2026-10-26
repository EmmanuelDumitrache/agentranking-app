import type { PrismaClient } from "@/generated/prisma/client";
import { invalidatePublicReputationStatistics } from "@/lib/invalidate-public-statistics";
import { getAttributableDaoVotes } from "@/lib/powerboost-payload";
import { agentPublicPath } from "@/lib/agent-public-url";
export type DaoVotesAdminRow = {
  id: number;
  rank: number;
  name: string;
  image: string;
  chainId: number;
  chainName: string;
  powerScore: number;
  daoVotes: number;
  adminPowerAdjust: number;
  activeBoosts: number;
  agentId: number;
  profilePath: string;
};
type AgentForDaoVotesAdmin = {
  id: number;
  rank: number;
  name: string;
  image: string;
  chainId: number;
  agentId: number;
  powerScore: number;
  activeBoosts: number;
  adminPowerAdjust: number;
  chain: { name: string } | null;
};
export function toDaoVotesAdminRow(agent: AgentForDaoVotesAdmin): DaoVotesAdminRow {
  const powerScore = Number(agent.powerScore);
  const adminPowerAdjust = Number(agent.adminPowerAdjust);
  const activeBoosts = Number(agent.activeBoosts);
  const daoVotes = getAttributableDaoVotes({ activeBoosts, adminPowerAdjust });
  return {
    id: agent.id,
    rank: agent.rank,
    name: String(agent.name ?? ""),
    image: String(agent.image ?? ""),
    chainId: agent.chainId,
    chainName:
      agent.chain?.name == null ? String(agent.chainId) : String(agent.chain.name),
    powerScore: Number.isFinite(powerScore) ? powerScore : 0,
    daoVotes,
    adminPowerAdjust: Number.isFinite(adminPowerAdjust) ? Math.trunc(adminPowerAdjust) : 0,
    activeBoosts: Number.isFinite(activeBoosts) ? activeBoosts : 0,
    agentId: agent.agentId,
    profilePath: agentPublicPath(agent),
  };
}
const DAO_VOTES_ADMIN_SELECT = {
  id: true,
  rank: true,
  name: true,
  image: true,
  chainId: true,
  agentId: true,
  powerScore: true,
  activeBoosts: true,
  adminPowerAdjust: true,
  chain: { select: { name: true } },
} as const;
export async function fetchDaoVotesAdminRow(
  db: PrismaClient,
  internalId: number,
): Promise<DaoVotesAdminRow | null> {
  const row = await db.agent.findUnique({
    where: { id: internalId },
    select: DAO_VOTES_ADMIN_SELECT,
  });
  if (!row) return null;
  return toDaoVotesAdminRow(row);
}
export async function invalidatePublicDaoVotesCaches(): Promise<void> {
  await invalidatePublicReputationStatistics();
}
export { DAO_VOTES_ADMIN_SELECT };
