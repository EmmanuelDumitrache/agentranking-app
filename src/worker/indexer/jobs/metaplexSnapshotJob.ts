import { discoverAndIndexMetaplexAgents } from "@/worker/indexer/sync/metaplex-discover-and-index";
import type { MetaplexSnapshotPayload } from "../queue/contracts.js";
export async function runMetaplexSnapshotJob(_payload: MetaplexSnapshotPayload, signal?: AbortSignal) {
  return discoverAndIndexMetaplexAgents({ limit: null, dryRun: false, signal });
}
