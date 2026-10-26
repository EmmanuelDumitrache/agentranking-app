import { isBackgroundJobsPaused } from "@/lib/pause-background-jobs";
export function backgroundJobPausedResult(): { ok: true; paused: true } | null {
  return isBackgroundJobsPaused() ? { ok: true, paused: true } : null;
}
