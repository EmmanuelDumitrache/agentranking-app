import "server-only";
import { getNumberFromBN } from "@streamflow/common";
import { SolanaStreamClient } from "@streamflow/stream";
import { AR_SOLANA_MINT, AR_TOKEN_DECIMALS } from "@/lib/ar-token-public";
import { publishedArTokenLocks, type ArTokenLockStatus } from "@/lib/ar-token-locks";
import { AR_TOTAL_SUPPLY } from "@/lib/ar-tokenomics";
import { streamflowRpcEndpoint } from "@/lib/streamflow-stake-config";
import type {
  StreamflowLockLiveSnapshot,
  StreamflowLocksLivePayload,
} from "@/lib/streamflow-vesting-types";
export type { StreamflowLockLiveSnapshot, StreamflowLocksLivePayload } from "@/lib/streamflow-vesting-types";
let cachedClient: SolanaStreamClient | null = null;
function streamClient(): SolanaStreamClient {
  if (!cachedClient) {
    cachedClient = new SolanaStreamClient(streamflowRpcEndpoint());
  }
  return cachedClient;
}
function deriveLockStatus(args: {
  canceledAt: number;
  deposited: number;
  withdrawn: number;
  remaining: number;
  unlockedNow: number;
  unlockAtUnix: number;
  nowUnix: number;
}): ArTokenLockStatus {
  if (args.canceledAt > 0) return "completed";
  if (args.remaining <= 1e-9 || args.withdrawn >= args.deposited - 1e-9) return "completed";
  if (args.unlockedNow > 0 && args.remaining > 0) return "unlocking";
  if (args.nowUnix >= args.unlockAtUnix && args.remaining > 0) return "unlocking";
  return "locked";
}
function percentOfSupplyFromTokens(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.round((tokens / AR_TOTAL_SUPPLY) * 1_000_000) / 10_000;
}
export async function fetchStreamflowLockLive(
  contractId: string,
  decimals = AR_TOKEN_DECIMALS,
): Promise<StreamflowLockLiveSnapshot> {
  const id = contractId.trim();
  const stream = await streamClient().getOne({ id });
  const nowUnix = Math.floor(Date.now() / 1000);
  const depositedTokens = getNumberFromBN(stream.depositedAmount, decimals);
  const withdrawnTokens = getNumberFromBN(stream.withdrawnAmount, decimals);
  const remainingTokens = stream.remaining(decimals);
  const unlockedNowTokens = getNumberFromBN(stream.unlocked(nowUnix), decimals);
  const unlockAtUnix = Number(stream.cliff) || Number(stream.start) || 0;
  const unlockAtIso =
    unlockAtUnix > 0 ? new Date(unlockAtUnix * 1000).toISOString() : "";
  return {
    contractId: id,
    mint: String(stream.mint ?? AR_SOLANA_MINT),
    recipient: String(stream.recipient ?? ""),
    depositedTokens,
    withdrawnTokens,
    remainingTokens,
    unlockedNowTokens,
    unlockAtUnix,
    unlockAtIso,
    status: deriveLockStatus({
      canceledAt: Number(stream.canceledAt) || 0,
      deposited: depositedTokens,
      withdrawn: withdrawnTokens,
      remaining: remainingTokens,
      unlockedNow: unlockedNowTokens,
      unlockAtUnix,
      nowUnix,
    }),
    percentOfSupply: percentOfSupplyFromTokens(depositedTokens),
  };
}
/** Live on-chain snapshots for every published Streamflow lock in the registry. */
export async function fetchPublishedStreamflowLocksLive(): Promise<StreamflowLocksLivePayload> {
  const entries = publishedArTokenLocks();
  const results = await Promise.allSettled(
    entries.map((entry) => fetchStreamflowLockLive(entry.streamflowContractId)),
  );
  const locks: StreamflowLockLiveSnapshot[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") locks.push(result.value);
  }
  const totalDepositedTokens = locks.reduce((sum, lock) => sum + lock.depositedTokens, 0);
  const totalRemainingTokens = locks.reduce((sum, lock) => sum + lock.remainingTokens, 0);
  const totalPercentOfSupply = locks.reduce((sum, lock) => sum + lock.percentOfSupply, 0);
  return {
    locks,
    totals: {
      count: locks.length,
      totalDepositedTokens,
      totalRemainingTokens,
      totalPercentOfSupply,
    },
    fetchedAt: new Date().toISOString(),
    cluster: process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim() || "mainnet-beta",
  };
}
