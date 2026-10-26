import { runStakePositionSync } from "@/lib/stake-sync";
import { backgroundJobPausedResult } from "../task-utils";
export async function stakeSyncJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const summary = await runStakePositionSync();
  if (!summary.ok) console.warn("[job/stake-sync]", summary);
  return summary;
}
