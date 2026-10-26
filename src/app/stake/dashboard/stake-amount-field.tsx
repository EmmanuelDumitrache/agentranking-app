"use client";
import { isValidStakingAmountInput } from "@/lib/ar-staking-preview";
import { STAKING_DASHBOARD_AMOUNT } from "@/lib/staking-dashboard-copy";
import styles from "./staking-dashboard.module.css";
const PRESETS = [
  { label: "25%", percent: 25 as const },
  { label: "50%", percent: 50 as const },
  { label: "75%", percent: 75 as const },
  { label: "Max", percent: 100 as const },
] as const;
export function StakeAmountField({
  amountStr,
  onAmountChange,
  availableLabel,
  walletEmpty,
  onPresetPercent,
}: Readonly<{
  amountStr: string;
  onAmountChange: (value: string) => void;
  availableLabel: string;
  walletEmpty: boolean;
  onPresetPercent: (percent: 25 | 50 | 75 | 100) => void;
}>) {
  const copy = STAKING_DASHBOARD_AMOUNT;
  const handleChange = (raw: string) => {
    onAmountChange(raw.replace(/\D/g, ""));
  };
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[13px] font-medium text-[var(--ar-text-primary)]" htmlFor="stake-dashboard-amount">
          {copy.label}
        </label>
        <span className="text-[12px] text-[var(--ar-text-tertiary)]">
          {copy.availablePrefix}{" "}
          <span className="font-semibold tabular-nums text-[var(--ar-text-primary)]">{availableLabel}</span> $AR
        </span>
      </div>
      <div className={styles.amountInputWrap}>
        <input
          id="stake-dashboard-amount"
          inputMode="numeric"
          pattern="[0-9]*"
          value={amountStr}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="0"
          className={styles.amountInput}
          aria-describedby="stake-dashboard-amount-hint"
        />
        <span className={styles.amountSuffix}>$AR</span>
      </div>
      <div className={styles.presetRow}>
        {PRESETS.map(({ label, percent }) => (
          <button
            key={label}
            type="button"
            className={styles.presetButton}
            disabled={walletEmpty}
            onClick={() => onPresetPercent(percent)}
          >
            {label}
          </button>
        ))}
      </div>
      <p id="stake-dashboard-amount-hint" className="text-[12px] leading-relaxed text-[var(--ar-text-tertiary)]">
        {copy.helper}
        {amountStr.trim() && !isValidStakingAmountInput(amountStr) ? (
          <span className="mt-1 block text-[var(--ar-text-secondary)]">Enter a whole number of $AR (no decimals).</span>
        ) : walletEmpty ? (
          <span className="mt-1 block">Connect a wallet with $AR to use quick amounts.</span>
        ) : null}
      </p>
    </div>
  );
}
