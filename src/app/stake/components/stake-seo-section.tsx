"use client";
import { StakeSiteLink } from "@/app/stake/shell/stake-site-link";
import { MotionSection } from "@/app/stake/shell/motion/motion-section";
import { StakeSiteSection } from "@/app/stake/shell/stake-site-section";
import { getStakeSiteUrl } from "@/lib/site-url";
export function StakeSeoSection() {
  const stake = getStakeSiteUrl();
  return (
    <StakeSiteSection
      id="stake-seo"
      eyebrow="LEARN"
      title="How $AR staking works."
      compact
      subtle
    >
      <MotionSection className="grid gap-3 sm:grid-cols-2">
        <article className="ar-public-glass rounded-xl p-4 sm:p-5">
          <h3 className="text-[14px] font-semibold text-[var(--ar-text-primary)]">Buyback-powered rewards</h3>
          <p className="mt-2 text-[13px] leading-[1.55] text-[var(--ar-text-secondary)]">
            Selected platform fees can fund $AR buybacks and staking reward pools. Rewards depend on real platform
            activity, pool balance, and staker participation — not a fixed APY.
          </p>
        </article>
        <article className="ar-public-glass rounded-xl p-4 sm:p-5">
          <h3 className="text-[14px] font-semibold text-[var(--ar-text-primary)]">Lock periods &amp; weighting</h3>
          <p className="mt-2 text-[13px] leading-[1.55] text-[var(--ar-text-secondary)]">
            Four lock durations (7, 30, 90, 180 days) map to reward pool shares of 10%, 15%, 25%, and 50%. Longer locks
            receive higher weighting when eligible rewards are distributed.
          </p>
        </article>
        <article className="ar-public-glass rounded-xl p-4 sm:p-5">
          <h3 className="text-[14px] font-semibold text-[var(--ar-text-primary)]">Streamflow · non-custodial</h3>
          <p className="mt-2 text-[13px] leading-[1.55] text-[var(--ar-text-secondary)]">
            Stakes are locked on-chain through Streamflow on Solana. AgentRanking does not custody your tokens. Review
            pool rules and receipt-token warnings before staking.
          </p>
        </article>
        <article className="ar-public-glass rounded-xl p-4 sm:p-5">
          <h3 className="text-[14px] font-semibold text-[var(--ar-text-primary)]">Reward variability</h3>
          <p className="mt-2 text-[13px] leading-[1.55] text-[var(--ar-text-secondary)]">
            No guaranteed returns. Past buybacks or distributions do not predict future rewards. See the{" "}
            <StakeSiteLink href={`${stake}#education`} className="ar-public-link">
              staking FAQ
            </StakeSiteLink>{" "}
            for full disclaimers.
          </p>
        </article>
      </MotionSection>
    </StakeSiteSection>
  );
}
