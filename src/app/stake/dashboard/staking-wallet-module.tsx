"use client";
import { Loader2, Wallet } from "lucide-react";
import type { PublicKey } from "@solana/web3.js";
import { STAKING_DASHBOARD_LEFT } from "@/lib/staking-dashboard-copy";
import { stakingPageSolanaClusterLabel } from "@/lib/streamflow-stake-config";
import { cn } from "@/lib/utils";
import styles from "./staking-dashboard.module.css";
function formatAddress(pk: PublicKey): string {
  const s = pk.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
export function StakingWalletModule({
  connected,
  publicKey,
  connectPhantom,
  disconnectPhantom,
  connecting,
  error,
  clearError,
  arBalanceLabel,
  solBalanceLabel,
}: Readonly<{
  connected: boolean;
  publicKey: PublicKey | null;
  connectPhantom: () => Promise<void>;
  disconnectPhantom: () => Promise<void>;
  connecting: boolean;
  error: string | null;
  clearError: () => void;
  arBalanceLabel: string;
  solBalanceLabel: string;
}>) {
  const copy = STAKING_DASHBOARD_LEFT;
  return (
    <div
      className={cn(
        styles.walletModule,
        connected && styles.walletModuleConnected,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                styles.statusDot,
                connected ? styles.statusDotConnected : styles.statusDotDisconnected,
              )}
              aria-hidden
            />
            <p className="text-[13px] font-semibold text-[var(--ar-text-primary)]">{copy.walletLabel}</p>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                connected
                  ? "border border-[var(--ar-border-strong)] bg-[var(--ar-glass-fill)] text-[var(--ar-text-primary)]"
                  : "border border-[var(--ar-border)] bg-[var(--ar-deep-inset)] text-[var(--ar-text-tertiary)]",
              )}
            >
              {connected ? "Connected" : copy.walletStatusDisconnected}
            </span>
          </div>
          <p className="text-[12px] text-[var(--ar-text-tertiary)]">
            Provider · <span className="font-medium text-[var(--ar-text-primary)]">{copy.provider}</span>
          </p>
          {connected && publicKey ? (
            <div className="space-y-1">
              <p className="font-mono text-[13px] font-medium tabular-nums text-[var(--ar-text-primary)]" title={publicKey.toBase58()}>
                {formatAddress(publicKey)}
              </p>
              <p className="text-[13px] text-[var(--ar-text-primary)]">
                <span className="text-[var(--ar-text-tertiary)]">Available · </span>
                <span className="font-semibold tabular-nums">{arBalanceLabel}</span>
                <span className="text-[var(--ar-text-tertiary)]"> $AR</span>
              </p>
              <p className="text-[12px] text-[var(--ar-text-tertiary)]">
                Network · {stakingPageSolanaClusterLabel()}
                {solBalanceLabel !== "—" ? (
                  <>
                    {" "}
                    · <span className="tabular-nums">{solBalanceLabel}</span> SOL
                  </>
                ) : null}
              </p>
            </div>
          ) : (
            <p className="text-[12px] leading-relaxed text-[var(--ar-text-tertiary)]">{copy.connectHelper}</p>
          )}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}{" "}
              <button type="button" className="underline underline-offset-2" onClick={clearError}>
                Dismiss
              </button>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {connected ? (
            <button
              type="button"
              className={styles.connectButton}
              onClick={() => void disconnectPhantom()}
            >
              {copy.disconnectCta}
            </button>
          ) : (
            <button
              type="button"
              disabled={connecting}
              className={styles.connectButton}
              onClick={(e) => {
                e.preventDefault();
                void connectPhantom();
              }}
            >
              {connecting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Wallet className="size-4" aria-hidden />
              )}
              {connecting ? "Connecting…" : copy.connectCta}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
