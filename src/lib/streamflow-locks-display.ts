import {
  arTokenLockTotals,
  formatLockTokenAmount,
  type ArTokenLockEntry,
} from "@/lib/ar-token-locks";
import type { StreamflowLocksLivePayload } from "@/lib/streamflow-vesting-types";
import type { MergedArTokenLock } from "@/lib/use-streamflow-locks";
function lockLive(lock: MergedArTokenLock | ArTokenLockEntry) {
  return "live" in lock ? lock.live : null;
}
export function resolveLockAmountTokens(lock: MergedArTokenLock | ArTokenLockEntry): number {
  return lockLive(lock)?.depositedTokens ?? lock.amountTokens;
}
export function resolveLockRemainingTokens(lock: MergedArTokenLock | ArTokenLockEntry): number | null {
  return lockLive(lock)?.remainingTokens ?? null;
}
export function resolveLockPercentOfSupply(lock: MergedArTokenLock | ArTokenLockEntry): number {
  return lockLive(lock)?.percentOfSupply ?? lock.percentOfSupply;
}
export function resolveLockUnlockIso(lock: MergedArTokenLock | ArTokenLockEntry): string {
  const liveIso = lockLive(lock)?.unlockAtIso;
  return liveIso?.trim() || lock.unlockAtIso;
}
export function resolveLockStatus(lock: MergedArTokenLock | ArTokenLockEntry): ArTokenLockEntry["status"] {
  return lockLive(lock)?.status ?? lock.status;
}
export function lockVaultProgressPercent(deposited: number, remaining: number): number {
  if (!Number.isFinite(deposited) || deposited <= 0) return 0;
  const withdrawn = Math.max(0, deposited - remaining);
  return Math.min(100, Math.max(0, (withdrawn / deposited) * 100));
}
/** Human-readable countdown until cliff unlock (client-safe). */
export function formatTimeUntilUnlock(unlockAtIso: string): string | null {
  const trimmed = unlockAtIso.trim();
  if (!trimmed) return null;
  const unlockMs = new Date(trimmed).getTime();
  if (Number.isNaN(unlockMs)) return null;
  const diffMs = unlockMs - Date.now();
  if (diffMs <= 0) return "Cliff reached — verify on Streamflow";
  const sec = Math.floor(diffMs / 1000);
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3600);
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `~${months} month${months === 1 ? "" : "s"} until unlock`;
  }
  if (days >= 1) return `${days}d ${hours}h until unlock`;
  const minutes = Math.floor((sec % 3600) / 60);
  return `${hours}h ${minutes}m until unlock`;
}
export function shortenSolanaAddress(address: string, chars = 4): string {
  const v = address.trim();
  if (v.length <= chars * 2 + 3) return v;
  return `${v.slice(0, chars)}…${v.slice(-chars)}`;
}
export function formatLiveUpdatedLabel(fetchedAt: string | null): string | null {
  if (!fetchedAt) return null;
  const then = new Date(fetchedAt).getTime();
  if (Number.isNaN(then)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 15) return "Updated just now";
  if (sec < 60) return `Updated ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Updated ${min}m ago`;
  return `Updated ${Math.floor(min / 60)}h ago`;
}
export function buildLockRegistrySummaryLabels(args: {
  liveTotals: StreamflowLocksLivePayload["totals"] | null;
  liveCount: number;
  staticTotals: ReturnType<typeof arTokenLockTotals>;
  isError: boolean;
}): {
  lockCountLabel: string;
  lockedAmountLabel: string;
  plannedLabel: string;
  liveHint: string | null;
} {
  const { liveTotals, liveCount, staticTotals, isError } = args;
  const useLive = Boolean(liveTotals && liveCount > 0 && !isError);
  let lockCountLabel: string;
  if (useLive && liveTotals) {
    lockCountLabel =
      liveTotals.count === 1 ? "1 published lock" : `${liveTotals.count} published locks`;
  } else {
    lockCountLabel =
      staticTotals.count === 1 ? "1 published lock" : `${staticTotals.count} published locks`;
  }
  let lockedAmountLabel: string;
  if (useLive && liveTotals) {
    lockedAmountLabel =
      liveTotals.totalRemainingTokens > 0
        ? `${formatLockTokenAmount(liveTotals.totalRemainingTokens)} remaining (${liveTotals.totalPercentOfSupply}% deposited)`
        : "Fully withdrawn";
  } else if (staticTotals.totalLockedTokens > 0) {
    lockedAmountLabel = `${formatLockTokenAmount(staticTotals.totalLockedTokens)} (${staticTotals.totalPercentOfSupply}% of supply)`;
  } else {
    lockedAmountLabel = "None yet";
  }
  const plannedLabel =
    staticTotals.plannedCount > 0
      ? `${formatLockTokenAmount(staticTotals.plannedTokens)} (${staticTotals.plannedPercentOfSupply}% · estimate TBA)`
      : "—";
  let liveHint: string | null = null;
  if (useLive) liveHint = "On-chain via Streamflow · refreshes every 30s";
  else if (isError) liveHint = "Showing registry defaults — live fetch failed";
  return { lockCountLabel, lockedAmountLabel, plannedLabel, liveHint };
}
