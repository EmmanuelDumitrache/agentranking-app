import { FEE_ALLOCATION_SHORT, REWARDS_DISCLAIMER } from "@/lib/token-economy-copy";
import {
  REWARD_POOLS,
  STAKING_FEE_ALLOCATION_PCT,
  STAKING_TREASURY_ALLOCATION_PCT,
} from "@/lib/staking-config";
function RailArrow() {
  return (
    <span className="docs-fw-arrow" aria-hidden>
      <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
        <path d="M0 5H16M16 5L12 1.5M16 5L12 8.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </span>
  );
}
export function DocsFlywheelOverview() {
  return (
    <figure className="docs-fw" aria-label="AgentRanking revenue flywheel overview">
      <div className="docs-fw-rail">
        <div className="docs-fw-chip">Platform fees</div>
        <RailArrow />
        <div className="docs-fw-allocation">
          <div className="docs-fw-allocation-primary">
            <span className="docs-fw-allocation-pct">{STAKING_FEE_ALLOCATION_PCT}%</span>
            <span className="docs-fw-allocation-label">Buybacks + rewards</span>
          </div>
          <div className="docs-fw-allocation-secondary">
            <span className="docs-fw-allocation-pct">{STAKING_TREASURY_ALLOCATION_PCT}%</span>
            <span className="docs-fw-allocation-label">Treasury</span>
          </div>
        </div>
        <RailArrow />
        <div className="docs-fw-chip">Reward pools</div>
        <RailArrow />
        <div className="docs-fw-chip docs-fw-chip--active">Stakers</div>
      </div>
      <div className="docs-fw-pools-section">
        <div className="docs-fw-pools-stem" aria-hidden />
        <div className="docs-fw-pools">
          {REWARD_POOLS.map((pool) => (
            <div key={pool.days} className="docs-fw-pool">
              <span className="docs-fw-pool-lock">{pool.lockPeriodLabel}</span>
              <span className="docs-fw-pool-share">{pool.poolSharePct}%</span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="docs-fw-caption">
        <p>{FEE_ALLOCATION_SHORT}</p>
        <p className="docs-fw-caption-sub">
          Each buyback drip splits across four pools by lock length (10% / 15% / 25% / 50%). Pool
          share is allocation weight — not fixed APY. Distributions run about every 30 minutes via
          Streamflow on Solana.
        </p>
        <p className="docs-fw-caption-disclaimer">{REWARDS_DISCLAIMER}</p>
      </figcaption>
    </figure>
  );
}
