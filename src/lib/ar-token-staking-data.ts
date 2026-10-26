import { prisma } from "@/lib/db";
import {
  AR_TOKEN_SETTING_ID,
  buildArTokenMetrics,
  type ArTokenEventView,
} from "@/lib/ar-token-metrics";
import { parseAmountUiToTierRaw } from "@/lib/ar-holder-tier-resolve";
import type { ArTokenStakingPublicView } from "@/lib/ar-token-staking-view";
const STAKING_METRIC_TYPES = ["staking_deposit", "staking_withdrawal", "staking_reward"] as const;
export type ReadArTokenStakingOptions = {
  /** Max deposit/withdrawal rows returned (newest first); omit for full list */
  flowLimit?: number;
  /** Max reward rows returned; omit for full list */
  rewardLimit?: number;
};
function sumStakingRewards(events: ArTokenEventView[]): number {
  let sum = 0;
  for (const e of events) {
    if (e.eventType !== "staking_reward") continue;
    const normalized = e.amountToken.replaceAll(",", "").trim();
    if (!normalized) continue;
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) sum += parsed;
  }
  return sum;
}
async function totalsFromStakePositions(): Promise<{
  stakedSupplyToken: number;
  activeStakers: number;
}> {
  const active = await prisma.arStakePosition.findMany({
    where: { status: "active" },
    select: { wallet: true, amountUi: true, amountRaw: true },
  });
  const wallets = new Set<string>();
  let supplyRaw = BigInt(0);
  for (const row of active) {
    wallets.add(row.wallet);
    const byUi = parseAmountUiToTierRaw(row.amountUi);
    if (byUi > BigInt(0)) {
      supplyRaw += byUi;
    } else if (/^\d+$/.test(row.amountRaw)) {
      supplyRaw += BigInt(row.amountRaw);
    }
  }
  const stakedSupplyToken = Number(supplyRaw) / 1e18;
  return {
    stakedSupplyToken: Number.isFinite(stakedSupplyToken) ? stakedSupplyToken : 0,
    activeStakers: wallets.size,
  };
}
/**
 * Public staking snapshot: positions drive supply/staker totals; metric events drive activity lists.
 */
export async function readArTokenStakingPublicPayload(
  options?: ReadArTokenStakingOptions,
): Promise<ArTokenStakingPublicView> {
  const [settings, stakingRows, positionTotals] = await Promise.all([
    prisma.arTokenSettings.findUnique({ where: { id: AR_TOKEN_SETTING_ID } }),
    prisma.arTokenMetricEvent.findMany({
      where: { eventType: { in: [...STAKING_METRIC_TYPES] } },
      orderBy: { occurredAt: "desc" },
    }),
    totalsFromStakePositions(),
  ]);
  const metrics = buildArTokenMetrics(settings, stakingRows, {});
  const rewardEvents = metrics.history.rewardEvents.filter((e) => e.eventType === "staking_reward");
  const flowAll = metrics.history.stakingEvents;
  const flowLimit = options?.flowLimit;
  const rewardLimit = options?.rewardLimit;
  const stakingFlowEvents =
    flowLimit != null && Number.isFinite(flowLimit) && flowLimit > 0 ? flowAll.slice(0, flowLimit) : flowAll;
  const stakingRewardEvents =
    rewardLimit != null && Number.isFinite(rewardLimit) && rewardLimit > 0
      ? rewardEvents.slice(0, rewardLimit)
      : rewardEvents;
  const listsMeta =
    (flowLimit != null && flowLimit > 0 && flowAll.length > stakingFlowEvents.length) ||
    (rewardLimit != null && rewardLimit > 0 && rewardEvents.length > stakingRewardEvents.length)
      ? {
          stakingFlowTotal: flowAll.length,
          stakingRewardTotal: rewardEvents.length,
          ...(flowLimit != null && flowLimit > 0 ? { flowLimit } : {}),
          ...(rewardLimit != null && rewardLimit > 0 ? { rewardLimit } : {}),
        }
      : undefined;
  const usePositionTotals = settings?.stakingEnabled ?? false;
  return {
    settings: metrics.settings,
    totals: {
      stakedSupplyToken: usePositionTotals
        ? positionTotals.stakedSupplyToken
        : metrics.totals.stakedSupplyToken,
      activeStakers: usePositionTotals ? positionTotals.activeStakers : metrics.totals.activeStakers,
      stakingRewardsToken: sumStakingRewards(metrics.history.rewardEvents),
    },
    stakingFlowEvents,
    stakingRewardEvents,
    generatedAt: new Date().toISOString(),
    ...(listsMeta ? { listsMeta } : {}),
  };
}