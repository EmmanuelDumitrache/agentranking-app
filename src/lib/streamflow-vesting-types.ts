import type { ArTokenLockStatus } from "@/lib/ar-token-locks";
export type StreamflowLockLiveSnapshot = Readonly<{
  readonly contractId: string;
  readonly mint: string;
  readonly recipient: string;
  readonly depositedTokens: number;
  readonly withdrawnTokens: number;
  readonly remainingTokens: number;
  readonly unlockedNowTokens: number;
  readonly unlockAtUnix: number;
  readonly unlockAtIso: string;
  readonly status: ArTokenLockStatus;
  readonly percentOfSupply: number;
}>;
export type StreamflowLocksLivePayload = Readonly<{
  readonly locks: readonly StreamflowLockLiveSnapshot[];
  readonly totals: Readonly<{
    readonly count: number;
    readonly totalDepositedTokens: number;
    readonly totalRemainingTokens: number;
    readonly totalPercentOfSupply: number;
  }>;
  readonly fetchedAt: string;
  readonly cluster: string;
}>;