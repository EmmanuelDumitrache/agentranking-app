import { getJobProducer } from "./boss";
import { JOB_QUEUES } from "./queues";

/**
 * Coalesce score/input mutations into one global projection pass after a short
 * quiet period. pg-boss persistence provides crash recovery.
 */
export async function enqueueGlobalRankProjection(revision?: bigint | number): Promise<string | null> {
  const boss = await getJobProducer();
  return boss.sendDebounced(
    JOB_QUEUES.MAINT_RECOMPUTE_RANKS,
    { v: 1, revision: revision == null ? null : String(revision) },
    null,
    10,
    "global",
  );
}
