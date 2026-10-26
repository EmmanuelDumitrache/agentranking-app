"use client";
import { useQuery } from "@tanstack/react-query";
import {
  arTokenLockTotals,
  publishedArTokenLocks,
  type ArTokenLockEntry,
} from "@/lib/ar-token-locks";
import type {
  StreamflowLockLiveSnapshot,
  StreamflowLocksLivePayload,
} from "@/lib/streamflow-vesting-types";
export type MergedArTokenLock = ArTokenLockEntry & {
  readonly live: StreamflowLockLiveSnapshot | null;
};
/** Client poll interval — keep in sync with locked-supply UI countdown. */
export const STREAMFLOW_LOCKS_POLL_MS = 30_000;
async function fetchStreamflowLocks(): Promise<StreamflowLocksLivePayload> {
  const res = await fetch("/api/token/streamflow-locks", { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as
    | StreamflowLocksLivePayload
    | { error?: string }
    | null;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && body.error
        ? body.error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!body || !("locks" in body)) throw new Error("Invalid streamflow locks response");
  return body;
}
export function mergeLocksWithLive(
  staticLocks: readonly ArTokenLockEntry[],
  liveLocks: readonly StreamflowLockLiveSnapshot[],
): MergedArTokenLock[] {
  const byContract = new Map(liveLocks.map((lock) => [lock.contractId, lock]));
  return staticLocks.map((lock) => ({
    ...lock,
    live: byContract.get(lock.streamflowContractId.trim()) ?? null,
  }));
}
export function useStreamflowLocks(initialData?: StreamflowLocksLivePayload | null) {
  const staticLocks = publishedArTokenLocks();
  const staticTotals = arTokenLockTotals();
  const initialDataUpdatedAt = initialData?.fetchedAt
    ? Date.parse(initialData.fetchedAt)
    : undefined;
  const query = useQuery<StreamflowLocksLivePayload>({
    queryKey: ["streamflow-locks"],
    queryFn: fetchStreamflowLocks,
    initialData: initialData ?? undefined,
    initialDataUpdatedAt:
      initialDataUpdatedAt != null && Number.isFinite(initialDataUpdatedAt)
        ? initialDataUpdatedAt
        : undefined,
    refetchOnMount: false,
    refetchInterval: STREAMFLOW_LOCKS_POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
    staleTime: 10_000,
  });
  const livePayload = query.data;
  const mergedLocks = mergeLocksWithLive(staticLocks, livePayload?.locks ?? []);
  const liveTotals = livePayload?.totals ?? null;
  const useLiveTotals = Boolean(liveTotals && liveTotals.count > 0);
  return {
    mergedLocks,
    staticLocks,
    staticTotals,
    livePayload,
    liveTotals: useLiveTotals ? liveTotals : null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    fetchedAt: livePayload?.fetchedAt ?? null,
  };
}
