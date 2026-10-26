"use client";
import { useCallback, useMemo } from "react";
import { AlertCircle } from "lucide-react";
import {
  StreamflowStakeForm,
  type StakingLockDays,
} from "@/app/stake/integrations/streamflow-stake-form";
import { StakingErrorBoundary } from "@/app/stake/integrations/staking-error-boundary";
import { STAKING_DASHBOARD_LEFT } from "@/lib/staking-dashboard-copy";
import { resolveArSolanaMint, resolveArTokenDecimals } from "@/lib/ar-token-public";
import { isValidSolanaMintString, trySolanaPublicKey } from "@/lib/ar-token-ledger";
import {
  isOnChainStakeLockPeriod,
  toOnChainStakeLockPeriod,
  type StakeLockDays,
} from "@/lib/stake-lock-periods";
import { useStakingPhantomConnect } from "@/lib/use-staking-phantom-connect";
import { useStakingWalletBalances } from "@/lib/use-staking-wallet-balances";
import type { StreamflowPoolConfigDto } from "@/lib/streamflow-stake-config";
import { splAmountFromWalletPercent, formatSplAmountForInput } from "@/lib/use-solana-ar-balance";
import { LockPeriodSelector } from "./lock-period-selector";
import { StakeAmountField } from "./stake-amount-field";
import { StakingWalletModule } from "./staking-wallet-module";
export function StakingDashboardPanel({
  selectedLockDays,
  onSelectedLockDaysChange,
  amountStr,
  onAmountChange,
  initialPoolConfig,
}: {
  readonly selectedLockDays: StakeLockDays;
  readonly onSelectedLockDaysChange: (days: StakeLockDays) => void;
  readonly amountStr: string;
  readonly onAmountChange: (value: string) => void;
  readonly initialPoolConfig?: StreamflowPoolConfigDto | null;
}) {
  const copy = STAKING_DASHBOARD_LEFT;
  const stakeable = isOnChainStakeLockPeriod(selectedLockDays);
  const onChainLockDays: StakingLockDays = stakeable
    ? toOnChainStakeLockPeriod(selectedLockDays)
    : 30;
  const mintStr = resolveArSolanaMint();
  const mintPk = useMemo(() => {
    if (!isValidSolanaMintString(mintStr)) return null;
    return trySolanaPublicKey(mintStr);
  }, [mintStr]);
  const arDecimals = resolveArTokenDecimals();
  const {
    publicKey,
    connected,
    connectPhantom,
    disconnectPhantom,
    connecting,
    error: walletConnectError,
    clearError: clearWalletConnectError,
  } = useStakingPhantomConnect();
  const { arBalanceRaw, arLabel, solLabel } = useStakingWalletBalances({
    mintPk,
    arDecimals,
    enabled: Boolean(mintPk),
    ownerPublicKey: publicKey,
  });
  const applyWalletPercent = useCallback(
    (percent: 25 | 50 | 75 | 100) => {
      let raw: bigint;
      if (percent === 75) {
        raw = (arBalanceRaw * BigInt(75)) / BigInt(100);
      } else {
        raw = splAmountFromWalletPercent(arBalanceRaw, percent);
      }
      const formatted = formatSplAmountForInput(raw, arDecimals);
      onAmountChange(formatted.includes(".") ? formatted.split(".")[0] ?? formatted : formatted);
    },
    [arBalanceRaw, arDecimals, onAmountChange],
  );
  return (
    <div className="flex h-full flex-col gap-8">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-[var(--ar-text-primary)]">{copy.title}</h3>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[var(--ar-text-secondary)]">{copy.description}</p>
      </div>
      <StakingWalletModule
        connected={connected}
        publicKey={publicKey}
        connectPhantom={connectPhantom}
        disconnectPhantom={disconnectPhantom}
        connecting={connecting}
        error={walletConnectError}
        clearError={clearWalletConnectError}
        arBalanceLabel={arLabel}
        solBalanceLabel={solLabel}
      />
      <LockPeriodSelector selectedDays={selectedLockDays} onSelectDays={onSelectedLockDaysChange} />
      <StakeAmountField
        amountStr={amountStr}
        onAmountChange={onAmountChange}
        availableLabel={arLabel}
        walletEmpty={arBalanceRaw <= BigInt(0)}
        onPresetPercent={applyWalletPercent}
      />
      {stakeable ? (
        <StakingErrorBoundary>
          <StreamflowStakeForm
            variant="stake-site"
            amountStr={amountStr}
            lockDays={onChainLockDays}
            initialPoolConfig={initialPoolConfig}
          />
        </StakingErrorBoundary>
      ) : (
        <div
          className="flex items-start gap-3 rounded-xl border border-dashed border-[var(--ar-border-strong)] bg-[var(--ar-deep-inset)] px-4 py-4 text-[13px] text-[var(--ar-text-secondary)]"
          role="status"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--ar-text-tertiary)]" aria-hidden />
          <p>{copy.plannedStakeHint}</p>
        </div>
      )}
      <p className="text-center text-[11px] tracking-wide text-[var(--ar-text-muted)]">{copy.trustRow}</p>
    </div>
  );
}
