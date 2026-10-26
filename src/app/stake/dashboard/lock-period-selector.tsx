"use client";
import { REWARD_POOLS } from "@/lib/staking-config";
import { STAKING_DASHBOARD_LOCK } from "@/lib/staking-dashboard-copy";
import type { StakeLockDays } from "@/lib/stake-lock-periods";
import { cn } from "@/lib/utils";
import styles from "./staking-dashboard.module.css";
export function LockPeriodSelector({
  selectedDays,
  onSelectDays,
}: Readonly<{
  selectedDays: StakeLockDays;
  onSelectDays: (days: StakeLockDays) => void;
}>) {
  return (
    <div>
      <p className="ar-public-label">{STAKING_DASHBOARD_LOCK.sectionLabel}</p>
      <div className={cn("mt-3", styles.lockGrid)} role="group" aria-label="Lock period">
        {REWARD_POOLS.map((pool) => {
          const isSelected = selectedDays === pool.days;
          return (
            <button
              key={pool.days}
              type="button"
              aria-pressed={isSelected}
              className={cn(styles.lockCard, isSelected && styles.lockCardSelected)}
              onClick={() => onSelectDays(pool.days)}
            >
              <span className="text-[13px] font-semibold text-[var(--ar-text-primary)]">
                {pool.lockPeriodLabel}
              </span>
              <span className="text-[11px] font-medium text-[var(--ar-text-tertiary)]">
                {pool.poolSharePct}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
