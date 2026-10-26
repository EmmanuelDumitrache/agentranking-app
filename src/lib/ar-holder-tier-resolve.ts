import { prisma } from "@/lib/db";
import {
  AR_HOLDER_TIERS,
  type ArHolderTier,
} from "@/lib/ar-holder-perk-config";
import {
  computeStakeBalancesByTier,
  HOLDER_TIER_RULE_SLUGS,
  HOLDER_TIER_SEED_DEFAULTS,
  holderTierJson,
  normalizeStakeWallet,
  parseAmountUiToTierRaw,
  recordedStakeBalanceForMinLock,
  recordedStakeBalanceForTier,
  splAmountRawToTierRaw,
  stakeAmountToTierRaw,
  tierLockSeconds,
  stakeTierFromPositions,
  type StakePortfolioRow,
  type StakeAmountRow,
  type StakeBalancesByTier,
} from "@/lib/ar-holder-tier-math";
export {
  computeStakeBalancesByTier,
  HOLDER_TIER_RULE_SLUGS,
  HOLDER_TIER_SEED_DEFAULTS,
  holderTierJson,
  normalizeStakeWallet,
  parseAmountUiToTierRaw,
  recordedStakeBalanceForMinLock,
  recordedStakeBalanceForTier,
  splAmountRawToTierRaw,
  stakeAmountToTierRaw,
  tierLockSeconds,
  stakeTierFromPositions,
  type StakeAmountRow,
  type StakeBalancesByTier,
};
function safeRuleRaw(raw: string | null | undefined, fallback: bigint): bigint {
  return /^\d+$/.test(raw ?? "") ? BigInt(raw!) : fallback;
}
export async function resolveHolderTiers(): Promise<readonly ArHolderTier[]> {
  const rules = await prisma.arStakePerkRule.findMany({
    where: { isActive: true, perkSlug: { in: Object.values(HOLDER_TIER_RULE_SLUGS) } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  const tiers = AR_HOLDER_TIERS.map((tier) => {
    const rule = rules.find((r) => r.perkSlug === HOLDER_TIER_RULE_SLUGS[tier.id]);
    if (!rule) return tier;
    return {
      ...tier,
      minBalanceRaw: safeRuleRaw(rule.minStakeRaw, tier.minBalanceRaw),
      minLockDays: Math.max(0, rule.minLockDays),
      summary: rule.description.trim() || tier.summary,
    };
  });
  return tiers;
}
export async function recordedStakePositionsForWallet(wallet: string): Promise<StakePortfolioRow[]> {
  const w = normalizeStakeWallet(wallet);
  if (!w) return [];
  const rows = await prisma.arStakePosition.findMany({
    where: { wallet: w, status: "active" },
    select: { amountUi: true, amountRaw: true, durationSec: true, lockEndAt: true },
  });
  return rows.map((row) => ({
    amountUi: row.amountUi,
    amountRaw: row.amountRaw,
    durationSec: row.durationSec,
    lockEndAt: row.lockEndAt?.toISOString() ?? null,
  }));
}
export async function unlockedStakeTierForWallet(wallet: string): Promise<{
  tier: ArHolderTier | null;
  tiers: readonly ArHolderTier[];
  balances: StakeBalancesByTier;
}> {
  const tiers = await resolveHolderTiers();
  const positions = await recordedStakePositionsForWallet(wallet);
  const balances = computeStakeBalancesByTier(positions, tiers);
  return { tier: balances.stakeTier, tiers, balances };
}
