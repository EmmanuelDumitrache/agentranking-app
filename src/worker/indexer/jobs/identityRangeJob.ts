import type { IdentityRangePayload } from "../queue/contracts.js";
import type { ProgressCheckpoint } from "../lib/progress.js";
import {
  executeIdentityRangeLease,
  type IdentityRangeExecutionResult,
} from "../sync/identity-range-leases.js";
import {
  rpcDeferredDetail,
  rpcDeferredReason,
  type RpcDeferredReason,
} from "../sync/rpc.js";

export type IdentityRangeJobResult = IdentityRangeExecutionResult & {
  deferredReason?: RpcDeferredReason;
  deferredDetail?: string;
};

export async function runIdentityRangeJob(
  payload: IdentityRangePayload,
  jobId: string,
  signal?: AbortSignal,
  checkpoint?: ProgressCheckpoint,
): Promise<IdentityRangeJobResult> {
  try {
    return await executeIdentityRangeLease({ payload, jobId, signal, checkpoint });
  } catch (error) {
    const effectiveError = signal?.aborted ? signal.reason ?? error : error;
    const deferredReason = rpcDeferredReason(effectiveError);
    if (signal?.aborted && deferredReason !== "job_timeout") throw effectiveError;
    if (!deferredReason) throw error;
    return {
      leaseId: payload.leaseId,
      skipped: false,
      enqueued: 0,
      decoded: 0,
      rejected: 0,
      advancedTo: null,
      targetBlock: BigInt(payload.targetBlock),
      complete: false,
      nextBlock: payload.fromBlock,
      deferredReason,
      deferredDetail: rpcDeferredDetail(effectiveError),
    };
  }
}
