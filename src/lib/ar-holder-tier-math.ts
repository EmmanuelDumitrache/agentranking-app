import { parseUnits } from "viem";
import { resolveArTokenDecimals } from "@/lib/ar-token-public";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import { type ArHolderTier, type ArHolderTierId } from "@/lib/ar-holder-perk-config";
export const HOLDER_TIER_RULE_SLUGS: Record<ArHolderTierId, string> = {
  node: "holder-tier-node",
  validator: "holder-tier-validator",
  core: "holder-tier-core",
};
export const HOLDER_TIER_SEED_DEFAULTS: ReadonlyArray<{
  slug: string;
  name: string;
  minStakeRaw: string;
  minLockDays: number;
  priority: number;
}> = [
  {
    slug: HOLDER_TIER_RULE_SLUGS.node,
    name: "Holder tier: Node (7d)",
    minStakeRaw: parseUnits("250000", 18).toString(),
    minLockDays: 7,
    priority: 30,
  },
  {
    slug: HOLDER_TIER_RULE_SLUGS.validator,
    name: "Holder tier: Validator (14d)",
    minStakeRaw: parseUnits("500000", 18).toString(),
    minLockDays: 14,
    priority: 20,
  },
  {
    slug: HOLDER_TIER_RULE_SLUGS.core,
    name: "Holder tier: Core (30d)",
    minStakeRaw: parseUnits("1000000", 18).toString(),
    minLockDays: 30,
    priority: 10,
  },
];
export type StakeAmountRow = {
  amountUi: string;
  amountRaw: string;
  durationSec: number;
};
export function normalizeStakeWallet(raw: string | null | undefined): string {
  return normalizeSolanaAddress(raw ?? "");
}
export function parseAmountUiToTierRaw(amountUi: string): bigint {
  const t = amountUi.trim().replaceAll(",", "");
  if (!/^\d+(\.\d+)?$/.test(t)) return BigInt(0);
  try {
    return parseUnits(t, 18);
  } catch {
    return BigInt(0);
  }
}
/** Convert on-chain SPL base units (e.g. 6 decimals) to 18-decimal tier scale. */
export function splAmountRawToTierRaw(
  amountRaw: string,
  decimals = resolveArTokenDecimals(),
): bigint {
  if (!/^\d+$/.test(amountRaw)) return BigInt(0);
  const raw = BigInt(amountRaw);
  const tierScale = 18;
  if (decimals === tierScale) return raw;
  if (decimals < tierScale) {
    return raw * BigInt(10) ** BigInt(tierScale - decimals);
  }
  return raw / BigInt(10) ** BigInt(decimals - tierScale);
}
export function stakeAmountToTierRaw(row: StakeAmountRow): bigint {
  const byUi = parseAmountUiToTierRaw(row.amountUi);
  if (byUi > BigInt(0)) return byUi;
  return splAmountRawToTierRaw(row.amountRaw);
}
export function recordedStakeBalanceForMinLock(rows: StakeAmountRow[], minDurationSec = 0): bigint {
  let total = BigInt(0);
  for (const r of rows) {
    if (minDurationSec > 0 && r.durationSec < minDurationSec) continue;
    total += stakeAmountToTierRaw(r);
  }
  return total;
}
export function tierLockSeconds(tier: ArHolderTier): number {
  return tier.minLockDays * 24 * 60 * 60;
}
export function recordedStakeBalanceForTier(rows: StakeAmountRow[], tier: ArHolderTier | null): bigint {
  return recordedStakeBalanceForMinLock(rows, tier ? tierLockSeconds(tier) : 0);
}
export function stakeTierFromPositions(
  rows: StakeAmountRow[],
  tiers: readonly ArHolderTier[],
): ArHolderTier | null {
  let unlocked: ArHolderTier | null = null;
  for (const tier of tiers) {
    if (recordedStakeBalanceForTier(rows, tier) >= tier.minBalanceRaw) {
      unlocked = tier;
    }
  }
  return unlocked;
}
export type StakePortfolioRow = StakeAmountRow & {
  lockEndAt?: string | null;
};
export type PortfolioStakeMetrics = {
  totalRaw: bigint;
  /** Longest lock period among active stakes (days). */
  maxLockDurationDays: number;
  /** Days until the stake that unlocks last (calendar). */
  daysUntilLastUnlock: number;
};
/** Sum all stakes; tier lock uses longest stake duration, not per-tier buckets. */
export function computePortfolioStakeMetrics(rows: readonly StakePortfolioRow[]): PortfolioStakeMetrics {
  const now = Date.now();
  let totalRaw = BigInt(0);
  let maxLockDurationDays = 0;
  let daysUntilLastUnlock = 0;
  for (const row of rows) {
    totalRaw += stakeAmountToTierRaw(row);
    if (row.durationSec > 0) {
      maxLockDurationDays = Math.max(maxLockDurationDays, Math.floor(row.durationSec / 86_400));
    }
    if (row.lockEndAt) {
      const endMs = new Date(row.lockEndAt).getTime();
      if (Number.isFinite(endMs)) {
        const days = Math.max(0, Math.ceil((endMs - now) / 86_400_000));
        daysUntilLastUnlock = Math.max(daysUntilLastUnlock, days);
      }
    }
  }
  return { totalRaw, maxLockDurationDays, daysUntilLastUnlock };
}
/** Highest tier where total staked amount and longest lock duration both qualify. */
export function unlockedStakeTierFromPortfolio(
  rows: readonly StakePortfolioRow[],
  tiers: readonly ArHolderTier[],
): ArHolderTier | null {
  const { totalRaw, maxLockDurationDays } = computePortfolioStakeMetrics(rows);
  let unlocked: ArHolderTier | null = null;
  for (const tier of tiers) {
    if (totalRaw >= tier.minBalanceRaw && maxLockDurationDays >= tier.minLockDays) {
      unlocked = tier;
    }
  }
  return unlocked;
}
export type StakeBalancesByTier = {
  node: bigint;
  validator: bigint;
  core: bigint;
  total: bigint;
  stakeTier: ArHolderTier | null;
  stakeBalanceRaw: bigint;
};
export function computeStakeBalancesByTier(
  rows: StakeAmountRow[],
  tiers: readonly ArHolderTier[],
): StakeBalancesByTier {
  const [node, validator, core] = tiers;
  const balNode = recordedStakeBalanceForTier(rows, node);
  const balValidator = recordedStakeBalanceForTier(rows, validator);
  const balCore = recordedStakeBalanceForTier(rows, core);
  const portfolioRows = rows as readonly StakePortfolioRow[];
  const metrics = computePortfolioStakeMetrics(portfolioRows);
  const stakeTier = unlockedStakeTierFromPortfolio(portfolioRows, tiers);
  return {
    node: balNode,
    validator: balValidator,
    core: balCore,
    total: metrics.totalRaw,
    stakeTier,
    stakeBalanceRaw: metrics.totalRaw,
  };
}
export function holderTierJson(tier: ArHolderTier) {
  return { ...tier, minBalanceRaw: tier.minBalanceRaw.toString() };
}
