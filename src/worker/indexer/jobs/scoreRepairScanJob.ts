import type { ScoreRepairScanPayload } from "../queue/contracts.js";
import { findStaleScoreAgentIds } from "../sync/score-recalculation.js";
import { enqueueScoreRecalculationBatch, enqueueScoreRepairScan } from "../queue/producer.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
import { getBootstrapExecutionState } from "../queue/bootstrap-state.js";
const SCORE_REPAIR_PAGE_SIZE = 1_000;
export async function runScoreRepairScan(payload: ScoreRepairScanPayload, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
  const after = payload.afterAgentId ?? 0;
  const ids = await findStaleScoreAgentIds(after, SCORE_REPAIR_PAGE_SIZE);
  const enqueued = await enqueueScoreRecalculationBatch(ids);
  if (ids.length === SCORE_REPAIR_PAGE_SIZE) {
    const bootstrap = await getBootstrapExecutionState();
    const continuationDelaySeconds = parseOptionalStrictUnsignedInteger(
      process.env.WORKER_SCORE_REPAIR_CONTINUATION_DELAY_SECONDS,
      "WORKER_SCORE_REPAIR_CONTINUATION_DELAY_SECONDS",
      bootstrap.phase === "DERIVED" ? 1 : 60,
      { maximum: 3_600 },
    );
    await enqueueScoreRepairScan(ids.at(-1), { startAfter: continuationDelaySeconds });
  }
  return { found: ids.length, enqueued, complete: ids.length < SCORE_REPAIR_PAGE_SIZE };
}
