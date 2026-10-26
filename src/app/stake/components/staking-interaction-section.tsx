"use client";
import { useState } from "react";
import { StreamflowSolanaWalletRoot } from "@/components/streamflow/streamflow-solana-wallet-root";
import { StakingDashboardFrame } from "@/app/stake/dashboard/staking-dashboard-frame";
import { StakingDashboardPanel } from "@/app/stake/dashboard/staking-dashboard-panel";
import {
  PoweredByStreamflow,
  RewardEstimatePanel,
} from "@/app/stake/primitives";
import { StakeSiteSection } from "@/app/stake/shell/stake-site-section";
import type { StakeLockDays } from "@/lib/stake-lock-periods";
import type { StakePageMetricsDto } from "@/lib/stake-page-data";
import type { StreamflowPoolConfigDto } from "@/lib/streamflow-stake-config";
import { STAKE_DASHBOARD_SECTION } from "@/lib/staking-config";
import { useFlywheelMetrics } from "./use-flywheel-metrics";
export function StakingInteractionSection({
  selectedLockDays,
  onSelectedLockDaysChange,
  initialMetrics,
  initialPoolConfig,
}: {
  readonly selectedLockDays: StakeLockDays;
  readonly onSelectedLockDaysChange: (days: StakeLockDays) => void;
  readonly initialMetrics?: StakePageMetricsDto | null;
  readonly initialPoolConfig?: StreamflowPoolConfigDto | null;
}) {
  const [amountStr, setAmountStr] = useState("");
  const { liveTotals } = useFlywheelMetrics(initialMetrics);
  return (
    <StakeSiteSection
      id="stake"
      eyebrow={STAKE_DASHBOARD_SECTION.eyebrow}
      title={STAKE_DASHBOARD_SECTION.title}
      description={STAKE_DASHBOARD_SECTION.subtitle}
      compact
      subtle
      className="scroll-mt-24"
    >
      <div className="ar-public-glass overflow-hidden rounded-xl">
        <PoweredByStreamflow variant="inline" className="px-4 pt-4 sm:px-5 sm:pt-5" />
        <StreamflowSolanaWalletRoot>
          <StakingDashboardFrame
            left={
              <StakingDashboardPanel
                selectedLockDays={selectedLockDays}
                onSelectedLockDaysChange={onSelectedLockDaysChange}
                amountStr={amountStr}
                onAmountChange={setAmountStr}
                initialPoolConfig={initialPoolConfig}
              />
            }
            right={
              <RewardEstimatePanel
                selectedLockDays={selectedLockDays}
                amountStr={amountStr}
                totalStakedToken={liveTotals?.stakedSupplyToken ?? null}
              />
            }
          />
        </StreamflowSolanaWalletRoot>
      </div>
    </StakeSiteSection>
  );
}
