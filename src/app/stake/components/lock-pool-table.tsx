"use client";
import { StakeSiteSection } from "@/app/stake/shell/stake-site-section";
import type { StakeLockDays } from "@/lib/stake-lock-periods";
import { REWARD_POOLS, STAKE_LOCK_SECTION } from "@/lib/staking-config";
import { cn } from "@/lib/utils";
export function LockPoolTable({
  selectedDays,
  onSelectDays,
}: {
  readonly selectedDays: StakeLockDays;
  readonly onSelectDays: (days: StakeLockDays) => void;
}) {
  return (
    <StakeSiteSection
      id="tiers"
      eyebrow={STAKE_LOCK_SECTION.eyebrow}
      title={STAKE_LOCK_SECTION.title}
      description={STAKE_LOCK_SECTION.subtitle}
      compact
      subtle
      className="scroll-mt-24"
    >
      <div className="ar-public-glass overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-[var(--ar-border)] text-left text-[10px] uppercase tracking-wide text-[var(--ar-text-tertiary)]">
                <th className="px-4 py-2.5 font-medium">Lock</th>
                <th className="px-4 py-2.5 font-medium">Pool share</th>
                <th className="px-4 py-2.5 font-medium">Notes</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {REWARD_POOLS.map((pool) => {
                const selected = selectedDays === pool.days;
                return (
                  <tr
                    key={pool.days}
                    className={cn(
                      "border-b border-[var(--ar-border)] last:border-0 transition-colors",
                      selected && "bg-[color-mix(in_oklab,var(--ar-blue)_8%,transparent)]",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-[var(--ar-text-primary)]">
                      {pool.lockPeriodLabel}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--ar-text-primary)]">
                      {pool.poolSharePct}%
                    </td>
                    <td className="px-4 py-3 text-[var(--ar-text-secondary)]">
                      {pool.live ? "Live on Streamflow" : "Planned — UI preview"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className={cn(
                          "ar-public-btn text-[10px]",
                          selected && "ar-public-btn-primary",
                        )}
                        onClick={() => onSelectDays(pool.days)}
                      >
                        {selected ? "Selected" : "Select"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-[10px] text-[var(--ar-text-muted)]">{STAKE_LOCK_SECTION.footnote}</p>
    </StakeSiteSection>
  );
}
