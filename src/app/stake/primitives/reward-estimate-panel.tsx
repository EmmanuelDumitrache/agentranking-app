"use client";
import Link from "next/link";
import { FeeFlowMini } from "@/app/stake/primitives/fee-flow-mini";
import { StakingPositionPanel } from "@/app/stake/dashboard/staking-position-panel";
import {
  estimatePoolShareLabel,
  formatLockEndDate,
  getRewardPool,
  isOnChainStakeLockPeriod,
  type StakeLockDays,
} from "@/lib/stake-lock-periods";
import { STAKING_DASHBOARD_REWARD } from "@/lib/staking-dashboard-copy";
import { REWARD_ESTIMATE_PENDING } from "@/lib/staking-config";
import { useStakingPhantomConnect } from "@/lib/use-staking-phantom-connect";
import { docsAbsoluteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";
import styles from "../dashboard/staking-dashboard.module.css";
function MetricTile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className={styles.metricTile}>
      <p className="ar-public-label">{label}</p>
      <p className="mt-1.5 text-[13px] font-semibold tabular-nums text-[var(--ar-text-primary)]">{value}</p>
    </div>
  );
}
export function RewardEstimatePanel({
  selectedLockDays,
  amountStr,
  totalStakedToken,
}: {
  readonly selectedLockDays: StakeLockDays;
  readonly amountStr: string;
  readonly totalStakedToken: number | null;
}) {
  const copy = STAKING_DASHBOARD_REWARD;
  const { publicKey, connected } = useStakingPhantomConnect();
  const pool = getRewardPool(selectedLockDays);
  const isLive = isOnChainStakeLockPeriod(selectedLockDays);
  const poolShareLabel = pool ? `${pool.poolSharePct}% pool share` : "—";
  const lockEnd = formatLockEndDate(selectedLockDays);
  const hasAmount = amountStr.trim().length > 0;
  const poolShareDisplay =
    !connected || !hasAmount
      ? "—"
      : estimatePoolShareLabel(amountStr, selectedLockDays, totalStakedToken ?? 0);
  const claimStatus = connected ? copy.claimStatusEmpty : "—";
  return (
    <div className="flex h-full flex-col gap-6">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-[var(--ar-text-primary)]">{copy.title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--ar-text-secondary)]">{copy.subtitle}</p>
      </div>
      {!connected ? (
        <div className={cn(styles.metricTile, "py-6 text-center")}>
          <p className="text-[13px] leading-relaxed text-[var(--ar-text-tertiary)]">{copy.emptyEstimate}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <MetricTile label="Selected lock" value={`${selectedLockDays} days`} />
          <MetricTile label="Pool share" value={poolShareLabel} />
          <MetricTile label="Est. pool share" value={poolShareDisplay} />
          <MetricTile label="Unlock date" value={lockEnd} />
          <MetricTile label={copy.claimStatusLabel} value={claimStatus} />
          <MetricTile label="Distribution source" value={copy.distributionSource} />
        </div>
      )}
      {connected && !isLive ? (
        <p className="text-[12px] text-[var(--ar-text-tertiary)]">
          This pool is not live yet — preview only. Choose 7 or 30 days to stake on Streamflow today.
        </p>
      ) : null}
      {totalStakedToken == null && connected ? (
        <p className="text-[12px] leading-relaxed text-[var(--ar-text-tertiary)]">{REWARD_ESTIMATE_PENDING}</p>
      ) : null}
      <FeeFlowMini />
      <div className={styles.holderLens}>
        <p className="text-[12px] leading-relaxed text-[var(--ar-text-secondary)]">{copy.holderLens}</p>
      </div>
      {connected ? <StakingPositionPanel connected={connected} publicKey={publicKey} /> : null}
      <Link
        href={docsAbsoluteUrl("/docs/staking")}
        className="ar-public-link mt-auto text-[12px] font-medium"
      >
        Holder tiers &amp; perks →
      </Link>
    </div>
  );
}
