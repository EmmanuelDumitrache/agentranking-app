import { type ArTokenEventView, type ArTokenMetricsView } from "@/lib/ar-token-metrics";
/** Public staking payload shape — safe to import from Client Components (no Prisma / pg). */
export type ArTokenStakingPublicView = {
  settings: ArTokenMetricsView["settings"];
  totals: {
    stakedSupplyToken: number;
    activeStakers: number;
    stakingRewardsToken: number;
  };
  /** Deposit + withdrawal rows, newest first */
  stakingFlowEvents: ArTokenEventView[];
  /** staking_reward rows only, newest first */
  stakingRewardEvents: ArTokenEventView[];
  generatedAt: string;
  /** When `flowLimit` / `rewardLimit` trim lists, totals still reflect all rows */
  listsMeta?: {
    stakingFlowTotal: number;
    stakingRewardTotal: number;
    flowLimit?: number;
    rewardLimit?: number;
  };
};