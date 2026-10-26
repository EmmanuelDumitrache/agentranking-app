import { config } from "../config.js";
import { syncValidationRegistryForChain } from "../sync/validation-registry.js";
import { getSyncableChainIds, rpcDeferredDetail, rpcDeferredReason, type RpcDeferredReason } from "../sync/rpc.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import type { ValidationSyncPayload } from "../queue/contracts.js";
import type { ProgressCheckpoint } from "../lib/progress.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
export type ValidationSyncJobResult = {
  upserted: number;
  scanned: number;
  hasMore: boolean;
  nextBlock: string | null;
  deferredReason?: RpcDeferredReason;
  deferredDetail?: string;
};
export async function runValidationSyncJob(
  chainId: number,
  payload: ValidationSyncPayload,
  signal?: AbortSignal,
  checkpoint?: ProgressCheckpoint,
): Promise<ValidationSyncJobResult> {
  if (chainId === SOLANA_CHAIN_ID) return { upserted: 0, scanned: 0, hasMore: false, nextBlock: null };
  const syncable = getSyncableChainIds();
  if (syncable.length > 0 && !syncable.includes(chainId)) return { upserted: 0, scanned: 0, hasMore: false, nextBlock: null };
  const configuredChunk = parseOptionalStrictUnsignedInteger(process.env.VALIDATION_GETLOGS_CHUNK, "VALIDATION_GETLOGS_CHUNK", 2_000, { maximum: 1_000_000 });
  const requested = Math.max(1, payload.maxBlocks ?? config.catchupMaxBlocks);
  const bounded = Math.min(requested, configuredChunk * Math.max(1, config.maxValidationChunksPerJob));
  try {
    return await syncValidationRegistryForChain(chainId, bounded, signal, checkpoint, payload.continuationFromBlock);
  } catch (error) {
    const effectiveError = signal?.aborted ? signal.reason ?? error : error;
    const deferredReason = rpcDeferredReason(effectiveError);
    if (signal?.aborted && deferredReason !== "job_timeout") throw effectiveError;
    if (!deferredReason) throw error;
    return { upserted: 0, scanned: 0, hasMore: false, nextBlock: null, deferredReason, deferredDetail: rpcDeferredDetail(effectiveError) };
  }
}
