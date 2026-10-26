import { runSapIndexer } from "../../../../services/sap-indexer";
import { backgroundJobPausedResult } from "../task-utils";
export async function sapSyncJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  return runSapIndexer({ respectBackgroundPause: true });
}
