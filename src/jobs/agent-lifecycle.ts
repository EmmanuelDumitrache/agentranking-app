import { getJobProducer } from "./boss";
import { JOB_QUEUES } from "./queues";

const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1_000;

export async function enqueueAgentDeactivationDue(
  agentId: number,
  lastActiveAt: Date,
): Promise<string | null> {
  const boss = await getJobProducer();
  const dueAt = new Date(lastActiveAt.getTime() + STALE_AFTER_MS);
  return boss.send(
    JOB_QUEUES.MAINT_AGENT_DEACTIVATE_DUE,
    { v: 1, agentId, lastActiveAt: lastActiveAt.toISOString() },
    {
      singletonKey: `${agentId}:${lastActiveAt.toISOString()}`,
      startAfter: dueAt,
    },
  );
}
