import type { Solana8004SnapshotPayload } from "../queue/contracts.js";
import { runDirectSolana8004Snapshot, type Solana8004SnapshotResult } from "../sync/solana-8004/snapshot.js";
import type { ProgressCheckpoint } from "../lib/progress.js";

export async function runSolana8004SnapshotJob(
  _payload: Solana8004SnapshotPayload,
  signal?: AbortSignal,
  checkpoint?: ProgressCheckpoint,
): Promise<Solana8004SnapshotResult> {
  await checkpoint?.({ phase: "solana-8004-direct-rpc" });
  return runDirectSolana8004Snapshot(signal);
}
