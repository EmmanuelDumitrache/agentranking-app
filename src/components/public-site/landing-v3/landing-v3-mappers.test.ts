import assert from "node:assert/strict";
import test from "node:test";
import { formatLandingStakeLabel } from "./landing-v3-mappers";
import type { PublicStakeSummary } from "@/lib/public-stake-summary";

function summary(partial: Partial<PublicStakeSummary>): PublicStakeSummary {
  return {
    generatedAt: "2026-08-21T00:00:00.000Z",
    stakingSource: "onchain",
    stakingEnabled: true,
    poolConfigured: true,
    clusterLabel: "Mainnet",
    totalStakedAr: null,
    activeStakers: null,
    stakingRewardsAr: null,
    bonusRewardsVaultAr: null,
    buybacksUsd: null,
    buybacksAr: null,
    buybacksSol: null,
    feesToFlywheelUsd: null,
    priceUsd: null,
    marketCapUsd: null,
    ...partial,
  };
}

test("formatLandingStakeLabel keeps the lock teaser until the animation completes", () => {
  assert.equal(
    formatLandingStakeLabel(summary({ totalStakedAr: 445_500_000, activeStakers: 30 }), false),
    "Lock $AR to earn",
  );
});

test("formatLandingStakeLabel hides empty synced zeros", () => {
  assert.equal(
    formatLandingStakeLabel(summary({ totalStakedAr: 0, activeStakers: 0 }), true),
    "Staking is live · stake.agentranking.io/stake",
  );
});

test("formatLandingStakeLabel shows live Streamflow totals", () => {
  assert.equal(
    formatLandingStakeLabel(summary({ totalStakedAr: 445_531_250.4, activeStakers: 30 }), true),
    "445.5M $AR locked · 30 stakers",
  );
});
