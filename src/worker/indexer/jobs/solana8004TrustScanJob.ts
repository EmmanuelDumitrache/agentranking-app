import type { Solana8004TrustScanPayload } from "../queue/contracts.js";
import type { ProgressCheckpoint } from "../lib/progress.js";
import { scanSolana8004TrustHistory, type Solana8004TrustScanResult } from "../sync/solana-8004/trust-scan.js";

export async function runSolana8004TrustScanJob(
  payload: Solana8004TrustScanPayload,
  signal?: AbortSignal,
  checkpoint?: ProgressCheckpoint,
): Promise<Solana8004TrustScanResult> {
  await checkpoint?.({ phase: "solana-8004-trust-signature-scan", requestedGeneration: payload.requestedGeneration ?? null });
  return scanSolana8004TrustHistory({ requestedGeneration: payload.requestedGeneration, signal });
}
