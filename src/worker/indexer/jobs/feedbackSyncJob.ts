import { syncFeedbackFromChain } from "../sync/feedback.js";
import { rpcDeferredDetail, rpcDeferredReason, type RpcDeferredReason } from "../sync/rpc.js";
import type { ProgressCheckpoint } from "../lib/progress.js";
export type FeedbackSyncJobResult = {
  synced: number;
  errors: number;
  scanned: number;
  hasMore: boolean;
  deferredReason?: RpcDeferredReason;
  deferredDetail?: string;
};
export async function runFeedbackSyncJob(
  chainId: number,
  signal?: AbortSignal,
  checkpoint?: ProgressCheckpoint,
): Promise<FeedbackSyncJobResult> {
  try {
    return await syncFeedbackFromChain(chainId, signal, checkpoint);
  } catch (error) {
    const effectiveError = signal?.aborted ? signal.reason ?? error : error;
    const deferredReason = rpcDeferredReason(effectiveError);
    if (signal?.aborted && deferredReason !== "job_timeout") throw effectiveError;
    if (!deferredReason) throw error;
    return { synced: 0, errors: 0, scanned: 0, hasMore: false, deferredReason, deferredDetail: rpcDeferredDetail(effectiveError) };
  }
}
