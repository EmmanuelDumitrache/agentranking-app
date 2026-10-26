import type { Prisma } from "@/generated/prisma/client";
import { HOLDER_POWER_BOOST_PERK, HOLDER_STAKE_BADGE_PERK } from "@/lib/ar-holder-perk-config";
/**
 * Agents whose persisted listing power can be attributed to a real product signal:
 * paid AgentBoost units (`activeBoosts`), active AR holder power perks, or admin adjust.
 * Does not use trust `score` or generic `powerScore > 0` alone (avoids stale trust-inflated rows).
 *
 * Future: when DAO staking boosts are persisted, extend the OR branch with that signal.
 */
export function listingPowerAttributionWhere(at: Date = new Date()): Prisma.AgentWhereInput {
  return {
    OR: [
      { activeBoosts: { gt: 0 } },
      { adminPowerAdjust: { not: 0 } },
      {
        holderAgentPerks: {
          some: {
            perkType: HOLDER_POWER_BOOST_PERK,
            status: "active",
            OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
          },
        },
      },
    ],
  };
}
/** Nested `findMany` args for `holderAgentPerks` — matches listing attribution holder branch. */
export function activeHolderPowerBoostRelationFind(at: Date = new Date()) {
  return {
    where: {
      perkType: HOLDER_POWER_BOOST_PERK,
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
    select: { id: true },
    take: 1,
  };
}
/** Active holder power + stake badge rows for agent detail/list includes. */
export function activeHolderPerksRelationFind(at: Date = new Date()) {
  return {
    where: {
      status: "active",
      perkType: { in: [HOLDER_POWER_BOOST_PERK, HOLDER_STAKE_BADGE_PERK] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
    select: { id: true, perkType: true, tierId: true, boostUnits: true },
  };
}
export {
  holderBadgeLabelFromTierId,
  parseHolderPerkFlags,
  type HolderPerkDisplayFlags,
  type HolderPerkRowLite,
} from "@/lib/holder-perk-agent-flags";
/**
 * Public leaderboard cohort (GET /api/powerboost when period=all) — same as HOT ticker,
 * home Power tab, and admin default scope: boost-backed or community holder power or admin.
 */
export function leaderboardAgentsWhereAllTime(): Prisma.AgentWhereInput {
  return {
    isActive: true,
    agentId: { not: 88888 },
    AND: [listingPowerAttributionWhere()],
  };
}
/**
 * Same cohort as all-time leaderboard, plus activity within a time window (period ≠ all).
 */
export function leaderboardAgentsWhereWithActivityWindow(since: Date): Prisma.AgentWhereInput {
  return {
    isActive: true,
    agentId: { not: 88888 },
    lastActiveAt: { gte: since },
    AND: [listingPowerAttributionWhere()],
  };
}
/** Sort order for leaderboard lists (tie-breakers match /api/powerboost). */
export const LEADERBOARD_AGENTS_ORDER_BY: Prisma.AgentOrderByWithRelationInput[] = [
  { powerScore: "desc" },
  { score: "desc" },
  { id: "asc" },
];
