import type { MedusaPassportTier } from "@/lib/medusa/types";
/** Matches @zkmedusa/passport-sdk PASSPORT_TIERS numeric values. */
const TIER_RANK: Record<MedusaPassportTier, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
};
export function medusaTierToSdkTier(tier: MedusaPassportTier): number {
  return TIER_RANK[tier];
}
export function medusaTierMeetsMinimum(
  actual: MedusaPassportTier,
  required: MedusaPassportTier,
): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}
export function sdkTierNumberToMedusaTier(tier: number | undefined): MedusaPassportTier | undefined {
  if (tier === TIER_RANK.bronze) return "bronze";
  if (tier === TIER_RANK.silver) return "silver";
  if (tier === TIER_RANK.gold) return "gold";
  return undefined;
}