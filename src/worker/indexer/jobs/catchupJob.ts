import { config } from "../config.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import type { ChainCatchupPayload } from "../queue/contracts.js";
import type { ProgressCheckpoint } from "../lib/progress.js";
import { rpcDeferredDetail, rpcDeferredReason, type RpcDeferredReason } from "../sync/rpc.js";
import {
  prepareIdentityRangePlan,
  type IdentityRangeLeasePayloadData,
} from "../sync/identity-range-leases.js";

export type CatchupJobResult = {
  enqueued: number;
  scannedTo: number;
  cursorBlock: string | null;
  hasMore: boolean;
  nextBlock: string | null;
  targetBlock: string | null;
  allocatedRanges: number;
  rangeLeases: IdentityRangeLeasePayloadData[];
  deferredReason?: RpcDeferredReason;
  deferredDetail?: string;
};

function compatibilityBlock(block: bigint | null): number {
  if (block == null) return 0;
  return block > 2_147_483_647n ? 2_147_483_647 : Number(block);
}

export async function runCatchupJob(
  chainId: number,
  payload: ChainCatchupPayload,
  signal?: AbortSignal,
  checkpoint?: ProgressCheckpoint,
): Promise<CatchupJobResult> {
  if (chainId === SOLANA_CHAIN_ID) {
    return { enqueued: 0, scannedTo: 0, cursorBlock: null, hasMore: false, nextBlock: null, targetBlock: null, allocatedRanges: 0, rangeLeases: [] };
  }
  const requested = Number(payload.maxBlocks ?? config.evmIdentityRangeBlocks);
  const rangeBlocks = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, config.evmIdentityRangeBlocks)
    : config.evmIdentityRangeBlocks;
  try {
    const plan = await prepareIdentityRangePlan({
      chainId,
      requestedGeneration: payload.requestedGeneration,
      maxBlocks: rangeBlocks,
      signal,
    });
    await checkpoint?.({
      phase: "identity-ranges-planned",
      chainId,
      targetBlock: plan.targetBlock.toString(10),
      cursorBlock: plan.cursorBlock?.toString(10) ?? null,
      allocatedRanges: plan.allocated,
      queueableRanges: plan.queueable.length,
    });
    return {
      enqueued: plan.previouslyEnqueued,
      scannedTo: compatibilityBlock(plan.cursorBlock),
      cursorBlock: plan.cursorBlock?.toString(10) ?? null,
      hasMore: !plan.complete,
      nextBlock: plan.nextBlock,
      targetBlock: plan.targetBlock.toString(10),
      allocatedRanges: plan.allocated,
      rangeLeases: plan.queueable,
    };
  } catch (error) {
    const effectiveError = signal?.aborted ? signal.reason ?? error : error;
    const deferredReason = rpcDeferredReason(effectiveError);
    if (signal?.aborted && deferredReason !== "job_timeout") throw effectiveError;
    if (!deferredReason) throw error;
    return {
      enqueued: 0,
      scannedTo: 0,
      cursorBlock: null,
      hasMore: false,
      nextBlock: null,
      targetBlock: null,
      allocatedRanges: 0,
      rangeLeases: [],
      deferredReason,
      deferredDetail: rpcDeferredDetail(effectiveError),
    };
  }
}
