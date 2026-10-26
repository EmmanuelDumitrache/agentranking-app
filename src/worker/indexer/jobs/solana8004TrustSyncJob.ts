import type { Solana8004TrustSyncPayload } from "../queue/contracts.js";
import type { ProgressCheckpoint } from "../lib/progress.js";
import { syncSolana8004TrustTransaction, type Solana8004TrustSyncResult } from "../sync/solana-8004/trust-sync.js";

export async function runSolana8004TrustSyncJob(
  payload: Solana8004TrustSyncPayload,
  signal?: AbortSignal,
  checkpoint?: ProgressCheckpoint,
): Promise<Solana8004TrustSyncResult> {
  await checkpoint?.({ phase: "solana-8004-trust-transaction", signature: payload.signature, slot: payload.slot });
  return syncSolana8004TrustTransaction({ signature: payload.signature, slot: BigInt(payload.slot), signal });
}
