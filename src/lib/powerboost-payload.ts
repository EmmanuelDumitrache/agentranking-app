import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import {
  activeHolderPerksRelationFind,
  parseHolderPerkFlags,
  type HolderPerkRowLite,
} from "@/lib/leaderboard-filters";
export const POWERBOOST_PERIOD_MS: Record<string, number> = {
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};
/** Lean list select — avoids heavy agentURI/services joins on leaderboard pages. */
const POWERBOOST_AGENT_SELECT_BASE = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  image: true,
  owner: true,
  score: true,
  rank: true,
  totalFeedback: true,
  hasDuplicateName: true,
  isVerified: true,
  isPremiumVerified: true,
  hotScore: true,
  powerScore: true,
  activeBoosts: true,
  adminPowerAdjust: true,
  lastActiveAt: true,
  chain: true,
  sapVerified: true,
} as const;
/** Build the relation filter per request so perk expiry never freezes at module load. */
export function powerBoostAgentSelect(activeAt: Date = new Date()) {
  return {
    ...POWERBOOST_AGENT_SELECT_BASE,
    holderAgentPerks: activeHolderPerksRelationFind(activeAt),
  } as const;
}
export type PowerBoostAgentRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string;
  owner: string;
  score: number;
  rank: number;
  totalFeedback: number;
  hasDuplicateName?: boolean;
  isVerified?: boolean;
  isPremiumVerified?: boolean;
  hotScore?: number;
  powerScore?: number;
  daoVotes?: number;
  stakingVotes?: number;
  activeBoosts?: number;
  adminPowerAdjust?: number;
  lastActiveAt?: Date | string | null;
  sapVerified?: boolean | null;
  holderAgentPerks?: ReadonlyArray<HolderPerkRowLite>;
};
export type DaoVotesListPayload = {
  agents: Array<
    Omit<PowerBoostAgentRow, "holderAgentPerks"> & {
      daoVotes: number;
      paidBoostVotes: number;
      adminVotes: number;
      slug: string;
      profilePath: string;
      hasHolderPowerBoost: boolean;
      hasHolderStakeBadge: boolean;
      holderBadgeLabel: string | null;
      holderStakeBadgeCount: number;
      holderPowerBoostBackerCount: number;
      holderPowerBoostUnits: number;
    }
  >;
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};
export type PowerBoostListPayload = DaoVotesListPayload;
export type DaoVoteBreakdown = {
  stakingVotes: number;
  paidBoostVotes: number;
  adminVotes: number;
  total: number;
};
/** Compact public breakdown (staking + paid only; admin is omitted from UI). */
export function formatDaoVoteBreakdownLine(
  breakdown: Pick<DaoVoteBreakdown, "stakingVotes" | "paidBoostVotes">,
): string | null {
  const parts: string[] = [];
  if (breakdown.stakingVotes > 0) parts.push(`+${breakdown.stakingVotes} staking`);
  if (breakdown.paidBoostVotes > 0) parts.push(`+${breakdown.paidBoostVotes} paid`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
export function computeDaoVoteBreakdown(agent: {
  activeBoosts?: number | null;
  adminPowerAdjust?: number | null;
  powerScore?: number | null;
  holderAgentPerks?: ReadonlyArray<HolderPerkRowLite> | null;
  holderPowerBoostUnits?: number | null;
}): DaoVoteBreakdown {
  const stakingVotes = Math.max(
    0,
    Math.round(
      agent.holderAgentPerks != null
        ? parseHolderPerkFlags(agent.holderAgentPerks).holderPowerBoostUnits
        : Number(agent.holderPowerBoostUnits ?? 0),
    ),
  );
  const paidBoostVotes = Math.max(0, Math.round(Number(agent.activeBoosts ?? 0)));
  const adminVotes = Math.max(0, Math.round(Number(agent.adminPowerAdjust ?? 0)));
  const total = stakingVotes + paidBoostVotes + adminVotes;
  return { stakingVotes, paidBoostVotes, adminVotes, total };
}
/** Staker-backed reputation votes (staking perks + paid boosts + admin adjust only). */
export function getAttributableDaoVotes(agent: {
  activeBoosts?: number | null;
  adminPowerAdjust?: number | null;
  holderPowerBoostUnits?: number | null;
  holderAgentPerks?: ReadonlyArray<HolderPerkRowLite> | null;
}): number {
  return computeDaoVoteBreakdown(agent).total;
}
export function powerBoostScoreVisible(agent: {
  activeBoosts?: number | null;
  adminPowerAdjust?: number | null;
  holderPowerBoostUnits?: number | null;
  holderAgentPerks?: ReadonlyArray<HolderPerkRowLite> | null;
  hasHolderPowerBoost?: boolean | null;
}): boolean {
  if (getAttributableDaoVotes(agent) > 0) return true;
  if (agent.hasHolderPowerBoost === true) return true;
  return false;
}
export function mapPowerBoostAgent(
  agent: PowerBoostAgentRow,
  index: number,
  page: number,
  perPage: number,
): PowerBoostListPayload["agents"][number] {
  const holderFlags = parseHolderPerkFlags(agent.holderAgentPerks);
  const { holderAgentPerks: _perks, ...rest } = agent;
  const breakdown = computeDaoVoteBreakdown({
    activeBoosts: agent.activeBoosts,
    adminPowerAdjust: agent.adminPowerAdjust,
    holderAgentPerks: agent.holderAgentPerks,
    holderPowerBoostUnits: holderFlags.holderPowerBoostUnits,
  });
  const daoVotes = Number.isSafeInteger(agent.daoVotes) ? Math.max(0, agent.daoVotes ?? 0) : breakdown.total;
  const stakingVotes = Number.isSafeInteger(agent.stakingVotes)
    ? Math.max(0, agent.stakingVotes ?? 0)
    : breakdown.stakingVotes;
  return {
    ...rest,
    daoVotes,
    stakingVotes,
    paidBoostVotes: breakdown.paidBoostVotes,
    adminVotes: breakdown.adminVotes,
    powerScore: agent.powerScore,
    ...holderFlags,
    rank: agent.rank > 0 ? agent.rank : (page - 1) * perPage + index + 1,
    slug: toAgentUrlSlug(agent.name),
    profilePath: agentPublicPath(agent),
  };
}
export function buildPowerBoostListPayload(
  agents: PowerBoostAgentRow[],
  total: number,
  page: number,
  perPage: number,
): PowerBoostListPayload {
  return {
    agents: agents.map((a, idx) => mapPowerBoostAgent(a, idx, page, perPage)),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}
