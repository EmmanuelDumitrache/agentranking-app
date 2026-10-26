import type { ScoreRecalculatePayload } from "../queue/contracts.js";
import { recalculateAgentScore } from "../sync/score-recalculation.js";
import { enqueueScoreRecalculation } from "../queue/producer.js";
export async function runScoreRecalculateJob(payload: ScoreRecalculatePayload, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
  const result = await recalculateAgentScore(payload.agentId);
  if (result === "raced") {
    await enqueueScoreRecalculation(payload.agentId);
    return result;
  }
  // Staleness is enforced by the daily MAINT_STALE_AGENT_SWEEP. Scheduling a separate
  // 90-day pg-boss job on every score recalculation created thousands of redundant
  // deferred jobs and provided no stronger correctness guarantee than the authoritative
  // predicate-based sweep.
  return result;
}
