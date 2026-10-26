/** Staking subdomain marketing copy and lock tier presentation. */
import { FEE_ALLOCATION_SHORT, REWARDS_DISCLAIMER } from "@/lib/token-economy-copy";
export const STAKING_FEE_ALLOCATION_PCT = 80 as const;
export const STAKING_TREASURY_ALLOCATION_PCT = 20 as const;
export type RewardPoolDays = 7 | 30 | 90 | 180;
export type RewardPool = {
  readonly days: RewardPoolDays;
  readonly poolSharePct: number;
  readonly rewardsLabel: string;
  readonly lockPeriodLabel: string;
  readonly live: boolean;
};
export const REWARD_POOLS: readonly RewardPool[] = [
  {
    days: 7,
    poolSharePct: 10,
    rewardsLabel: "$AR buyback rewards",
    lockPeriodLabel: "7 days",
    live: true,
  },
  {
    days: 30,
    poolSharePct: 15,
    rewardsLabel: "$AR buyback rewards",
    lockPeriodLabel: "30 days",
    live: true,
  },
  {
    days: 90,
    poolSharePct: 25,
    rewardsLabel: "$AR buyback rewards",
    lockPeriodLabel: "90 days",
    live: false,
  },
  {
    days: 180,
    poolSharePct: 50,
    rewardsLabel: "$AR buyback rewards",
    lockPeriodLabel: "180 days",
    live: false,
  },
] as const;
export const STAKE_LOCK_SECTION = {
  eyebrow: "LOCK TIERS",
  title: "Longer lock, bigger slice.",
  subtitle:
    "Selected platform fees split across four reward pools (10% / 15% / 25% / 50%). Pick how long you want to commit — longer locks receive a larger share of eligible buyback rewards.",
  footnote:
    "Pool share reflects reward allocation policy, not fixed APY. Final rewards vary with platform fees and staker participation.",
} as const;
export const STAKING_HOW_IT_WORKS = {
  eyebrow: "HOW IT WORKS",
  title: "Four steps. No guesswork.",
  subtitle: "Fee-backed staking through Streamflow on Solana.",
  steps: [
    {
      title: "Connect a Solana wallet",
      copy: "Phantom, Solflare, Backpack, or any wallet that signs on Solana. Hold $AR to begin.",
    },
    {
      title: "Pick your lock",
      copy: "7, 30, 90, or 180 days. Each rewards pool gets a fixed slice of fee-backed buyback rewards. Longer locks get the bigger slice.",
    },
    {
      title: "Stake and earn",
      copy: "Sign once. Lock $AR on-chain through Streamflow. Rewards depend on real platform fees and pool participation.",
    },
    {
      title: "Claim at lock end",
      copy: "Recover principal and any unclaimed rewards when your lock period ends, per Streamflow pool rules.",
    },
  ],
  footnote:
    "Staking is non-custodial through Streamflow. AgentRanking cannot manually move your locked tokens.",
} as const;
export const STAKE_FINAL_CTA = {
  title: "Lock $AR. Align with the agent graph.",
  subcopy: "Fee-backed staking through Streamflow. Dynamic rewards, not fixed APY.",
} as const;
export const STAKE_PAGE_HERO = {
  eyebrow: "$AR STAKING · FEE-BACKED REWARDS",
  title: "Stake $AR.",
  titleLine2: "Earn from the AgentRanking flywheel.",
  subcopy:
    "AgentRanking routes 80% of selected platform fees into $AR buybacks and staking rewards. Lock $AR, support the agent graph, and receive your share of eligible reward distributions.",
} as const;
export const STAKE_PAGE_STATS_LABELS = [
  { key: "totalStaked" as const, label: "Total staked" },
  { key: "activeStakers" as const, label: "Active stakers" },
  { key: "rewardsDistributed" as const, label: "Rewards paid" },
  { key: "feesAllocated" as const, label: "Platform fees allocated" },
  { key: "lockedSupplyPercent" as const, label: "Locked supply" },
  { key: "nextRewardCycle" as const, label: "Next distribution" },
] as const;
export const STAKE_REWARD_MODEL = {
  eyebrow: "FLYWHEEL",
  title: "How the $AR flywheel works",
  subtitle: "Fee-backed rewards are dynamic, not fixed APY.",
  steps: [
    "AgentRanking earns fees from verification, listings, ads, API/tools, and partner placements.",
    "80% of selected fees are routed into $AR buybacks and staking rewards.",
    "Rewards are distributed to eligible locked stakers.",
    "Longer locks may receive larger reward weighting.",
    "Locked supply reduces short-term sell pressure and aligns holders with platform growth.",
  ],
  disclaimer:
    "Rewards are variable and depend on platform revenue, available reward pool balance, staking participation, lock duration, and pool configuration. AgentRanking does not offer fixed APY or guaranteed returns.",
} as const;
export const STAKE_NAV_LINKS = [
  { href: "#flywheel", label: "Flywheel" },
  { href: "#tiers", label: "Pools" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#stake", label: "Stake" },
  { href: "#faq", label: "FAQ" },
] as const;
export const STAKE_TRUST_BADGES = [
  "Powered by Streamflow",
  "On-chain locks",
  "No fixed APY",
  "Rewards depend on platform fees",
] as const;
export const REWARD_ESTIMATE_PENDING =
  "Live pool data appears as integrations come online.";
export const STAKE_DASHBOARD_SECTION = {
  eyebrow: "STAKE",
  title: "Staking dashboard",
  subtitle:
    "Connect, choose a lock, and stake through Streamflow. Live pool data appears as integrations come online.",
} as const;
export const STAKE_FAQ_SECTION = {
  eyebrow: "FAQ",
  title: "Questions",
  subtitle: "Dynamic rewards, risks, Streamflow, and fee allocation.",
} as const;
export const STAKE_ACTIVITY_SECTION = {
  eyebrow: "ACTIVITY",
  title: "Recent flywheel activity",
  subtitle: "Buybacks and reward distributions will appear here as they occur.",
} as const;
export { FEE_ALLOCATION_SHORT, REWARDS_DISCLAIMER };
