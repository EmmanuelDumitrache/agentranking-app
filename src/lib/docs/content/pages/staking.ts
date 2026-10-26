import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
import { FEE_ALLOCATION_FLYWHEEL, REWARDS_DISCLAIMER } from "@/lib/token-economy-copy";
import { getStakeSiteUrl } from "@/lib/site-url";
import { REWARD_POOLS, STAKE_REWARD_MODEL } from "@/lib/staking-config";
const STAKE_URL = getStakeSiteUrl();
export const stakingPage: DocsPageSpec = {
  slug: "staking",
  pageTitle: "Staking",
  subtitle:
    "How Streamflow staking connects $AR holders to AgentRanking ecosystem mechanics.",
  blocks: [
    b.callout(
      "token",
      "Important",
      "Not financial advice. Rewards are variable and depend on platform activity, pool participation, and lock duration.",
    ),
    b.flywheelOverview(),
    b.h2("Revenue flywheel", "revenue-flywheel", [
      b.p(FEE_ALLOCATION_FLYWHEEL),
      b.ul(STAKE_REWARD_MODEL.steps),
      b.p(STAKE_REWARD_MODEL.disclaimer),
    ]),
    b.h2("Reward pools", "reward-pools", [
      b.p(
        "Every ~30 minutes, eligible buyback rewards drip into four pools. Stakers in the same pool share proportionally by stake size. Longer locks draw from a bigger slice of each distribution.",
      ),
      b.table(
        ["Lock period", "Pool share"],
        REWARD_POOLS.map((pool) => [pool.lockPeriodLabel, `${pool.poolSharePct}% of each drip`]),
      ),
    ]),
    b.h2("What happens on-chain", "on-chain", [
      b.ol([
        "Your $AR moves into a non-custodial Streamflow vault. You receive a receipt token that records the position — it cannot be transferred and is burned when you unstake.",
        "Your principal stays locked until the period ends (7, 30, 90, or 180 days). The rule is enforced on-chain; nobody can override it.",
        "Buybacks and reward batches land in your pool on a recurring cadence and split across everyone in it by stake size.",
        "Claim rewards to your wallet anytime, compound into a new lock, or unstake at lock end to recover principal and any unclaimed rewards.",
      ]),
      b.callout(
        "info",
        "Receipt token note",
        "Your wallet may flag the receipt as unknown or freezable. That is the lock doing its job — when you unstake, the receipt is burned and $AR returns to your wallet.",
      ),
    ]),
    b.h2("Revenue sources", "revenue-sources", [
      b.p("Selected platform fees that feed the flywheel include:"),
      b.ul([
        "Verification and Dashboard services",
        "Featured placements and ads",
        "Referrals and partner integrations",
        "Jobs, API usage, and marketplace activity",
        "Future launches and tokenized agent surfaces",
      ]),
    ]),
    b.h2("Treasury & transparency", "treasury-and-transparency", [
      b.p(
        "The remaining 20% of selected fees supports treasury operations — infrastructure, development, partnerships, and ecosystem growth — with on-chain transparency where applicable.",
      ),
    ]),
    b.actions([{ label: "Open staking site", href: STAKE_URL, variant: "primary" }]),
    b.callout("warning", "Risk disclosure", REWARDS_DISCLAIMER),
  ],
};
