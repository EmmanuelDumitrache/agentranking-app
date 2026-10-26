import {
  getHolderTierById,
  HOLDER_POWER_BOOST_PERK,
  HOLDER_STAKE_BADGE_PERK,
} from "@/lib/ar-holder-perk-config";
export type HolderPerkRowLite = {
  perkType: string;
  tierId?: string | null;
  boostUnits?: number | null;
};
export type HolderPerkDisplayFlags = {
  hasHolderPowerBoost: boolean;
  hasHolderStakeBadge: boolean;
  holderBadgeLabel: string | null;
  holderStakeBadgeCount: number;
  holderPowerBoostBackerCount: number;
  holderPowerBoostUnits: number;
};
export function holderBadgeLabelFromTierId(tierId: string | null | undefined): string | null {
  if (!tierId) return null;
  return getHolderTierById(tierId)?.badgeLabel ?? null;
}
export function parseHolderPerkFlags(
  rows: ReadonlyArray<HolderPerkRowLite> | null | undefined,
): HolderPerkDisplayFlags {
  const list = rows ?? [];
  const badgeRows = list.filter((r) => r.perkType === HOLDER_STAKE_BADGE_PERK);
  const powerRows = list.filter((r) => r.perkType === HOLDER_POWER_BOOST_PERK);
  const topBadgeTier = badgeRows
    .map((r) => r.tierId)
    .filter((id): id is string => Boolean(id))
    .map((id) => getHolderTierById(id))
    .filter((t): t is NonNullable<ReturnType<typeof getHolderTierById>> => Boolean(t))
    .sort((a, b) => Number(b.minBalanceRaw - a.minBalanceRaw))[0];
  return {
    hasHolderPowerBoost: powerRows.length > 0,
    hasHolderStakeBadge: badgeRows.length > 0,
    holderBadgeLabel: topBadgeTier?.badgeLabel ?? holderBadgeLabelFromTierId(badgeRows[0]?.tierId),
    holderStakeBadgeCount: badgeRows.length,
    holderPowerBoostBackerCount: powerRows.length,
    holderPowerBoostUnits: powerRows.reduce((sum, r) => sum + Math.max(0, Number(r.boostUnits ?? 0)), 0),
  };
}