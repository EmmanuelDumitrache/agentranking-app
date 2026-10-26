import { RecentActivityTable } from "@/app/stake/primitives";
import { StakeSiteSection } from "@/app/stake/shell/stake-site-section";
import { stakeActivityRows, STAKE_ACTIVITY_EMPTY } from "@/lib/stake-page-data";
import { STAKE_ACTIVITY_SECTION } from "@/lib/staking-config";
const GHOST_ROWS = [
  { type: "Buyback", amount: "—", time: "—" },
  { type: "Distribution", amount: "—", time: "—" },
  { type: "Fee routing", amount: "—", time: "—" },
] as const;
export function RecentActivitySection() {
  return (
    <StakeSiteSection
      id="activity"
      eyebrow={STAKE_ACTIVITY_SECTION.eyebrow}
      title={STAKE_ACTIVITY_SECTION.title}
      description={STAKE_ACTIVITY_SECTION.subtitle}
      compact
      subtle
    >
      <div className="relative overflow-hidden ar-public-glass rounded-xl">
        {stakeActivityRows.length === 0 ? (
          <>
            <div className="pointer-events-none absolute inset-0 px-4 pt-10 opacity-[0.35]" aria-hidden>
              {GHOST_ROWS.map((row) => (
                <div
                  key={row.type}
                  className="mb-2 flex items-center justify-between border-b border-[var(--ar-border)] py-2 text-[11px] text-[var(--ar-text-muted)]"
                >
                  <span>{row.type}</span>
                  <span className="tabular-nums">{row.amount}</span>
                  <span>{row.time}</span>
                </div>
              ))}
            </div>
            <div className="relative px-4 py-8 text-center sm:py-10">
              <p className="text-[13px] font-medium text-[var(--ar-text-primary)]">No flywheel activity yet</p>
              <p className="mx-auto mt-2 max-w-sm text-[12px] leading-[1.45] text-[var(--ar-text-tertiary)]">
                {STAKE_ACTIVITY_EMPTY}
              </p>
            </div>
          </>
        ) : (
          <RecentActivityTable rows={stakeActivityRows} />
        )}
      </div>
    </StakeSiteSection>
  );
}
