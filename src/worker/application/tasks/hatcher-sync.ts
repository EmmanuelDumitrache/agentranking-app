import { runHatcherIndexer } from "../../../../services/hatcher-indexer";
import { backgroundJobPausedResult } from "../task-utils";
export async function hatcherSyncJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  return runHatcherIndexer({ respectBackgroundPause: true });
}
