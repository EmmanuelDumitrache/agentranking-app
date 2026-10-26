import { REWARD_POOLS, type RewardPoolDays } from "@/lib/staking-config";
import type { OnChainStakeLockDays } from "@/lib/stake-page-data";
import type { StakingLockDays } from "@/app/stake/integrations/streamflow-stake-form";
export type StakeLockDays = RewardPoolDays;
export function getRewardPool(days: StakeLockDays) {
  return REWARD_POOLS.find((p) => p.days === days);
}
export function getRewardWeightPct(days: StakeLockDays): number {
  return getRewardPool(days)?.poolSharePct ?? 10;
}
export function isOnChainStakeLockPeriod(days: StakeLockDays): days is OnChainStakeLockDays {
  return days === 7 || days === 30;
}
export function toOnChainStakeLockPeriod(days: OnChainStakeLockDays): StakingLockDays {
  return days;
}
export function formatLockEndDate(lockDays: StakeLockDays): string {
  const end = new Date();
  end.setDate(end.getDate() + lockDays);
  return end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
export function estimatePoolShareLabel(
  amountStr: string,
  lockDays: StakeLockDays,
  totalStakedToken: number,
): string {
  const amount = Number(amountStr.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  if (!Number.isFinite(totalStakedToken) || totalStakedToken <= 0) return "—";
  const weight = getRewardWeightPct(lockDays) / 100;
  const weighted = (amount / totalStakedToken) * weight * 100;
  if (!Number.isFinite(weighted) || weighted <= 0) return "<0.01% est. share";
  if (weighted < 0.01) return "<0.01% est. share";
  return `~${weighted.toFixed(2)}% est. share`;
}
