import type { PgBoss, QueuePolicy, QueueResult } from "pg-boss";
import { JOB_QUEUES } from "./queues";
import {
  asPgBossQueueOptions,
  assertPgBossQueueDefinitions,
  assertPgBossQueueMatches,
  orderPgBossQueueDefinitionsForCreation,
  type PgBossQueueOptions,
} from "./queue-policy";
type QueueDefinition = { name: string; policy: QueuePolicy; options: PgBossQueueOptions };
const deadLetterOptions: PgBossQueueOptions = {
  notify: true,
  retryLimit: 0,
  expireInSeconds: 15 * 60,
  retentionSeconds: 30 * 24 * 60 * 60,
  // The worker records a rate-limited terminal-failure diagnostic before
  // completing these jobs. Keeping completed DLQ rows for a month makes every
  // pg-boss queue-stat aggregate revisit an avoidably large failure history.
  deleteAfterSeconds: 24 * 60 * 60,
  warningQueueSize: 100,
};
const durableBase: PgBossQueueOptions = {
  notify: true,
  retryLimit: 5,
  retryDelay: 10,
  expireInSeconds: 30 * 60,
  heartbeatSeconds: 60,
  retentionSeconds: 14 * 24 * 60 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
  deadLetter: JOB_QUEUES.DEAD_LETTER,
  warningQueueSize: 250,
};
const durable: PgBossQueueOptions = {
  ...durableBase,
  retryBackoff: true,
  retryDelayMax: 30 * 60,
};
const fanOutDurable: PgBossQueueOptions = {
  ...durable,
  // Domain receipts and indexer ledgers retain the durable outcome; keeping
  // completed fan-out jobs longer only inflates pg-boss supervision scans.
  deleteAfterSeconds: 10 * 60,
};
const fixedDelayDurable: PgBossQueueOptions = {
  ...durableBase,
  retryBackoff: false,
  // Explicit null clears a stale cap when reconciling an existing queue.
  retryDelayMax: null,
};
const longRunning: PgBossQueueOptions = {
  ...durable,
  expireInSeconds: 60 * 60,
  heartbeatSeconds: 60,
};
const exclusive = [
  JOB_QUEUES.PARTNER_JOBS_SCAN,
  JOB_QUEUES.PARTNER_SAP_SYNC,
  JOB_QUEUES.PARTNER_METAPLEX_DISCOVER,
  JOB_QUEUES.PARTNER_METAPLEX_REINDEX,
  JOB_QUEUES.PARTNER_HATCHER_SYNC,
  JOB_QUEUES.PARTNER_FAIRSCALE_SCAN,
  JOB_QUEUES.PARTNER_INFERENCE_SCAN,
  JOB_QUEUES.PARTNER_X402_DIRECTORY_REFRESH,
  JOB_QUEUES.MAINT_RECOMPUTE_RANKS,
  JOB_QUEUES.MAINT_RANK_SNAPSHOT,
  JOB_QUEUES.MAINT_STALE_AGENT_SWEEP,
  JOB_QUEUES.MAINT_ROBINHOOD_PREPARATION_PRUNE,
  JOB_QUEUES.MAINT_PERF_SCAN,
  JOB_QUEUES.MAINT_ACTIVITY_SCAN,
  JOB_QUEUES.MAINT_ENDPOINT_SCAN,
  JOB_QUEUES.MAINT_STAKE_SYNC,
  JOB_QUEUES.MAINT_OPENROUTER_BALANCE_SNAPSHOT,
  JOB_QUEUES.MAINT_MCP_CATALOG_REFRESH,
  JOB_QUEUES.CHAT_STALE_RUN_SCAN,
  JOB_QUEUES.MEMORY_OUTBOX_DISPATCH,
  JOB_QUEUES.SUBSCRIPTION_NOTIFICATION_SCAN,
  JOB_QUEUES.AGENT_SCHEDULE_SCAN,
  JOB_QUEUES.LAUNCH_FEE_SCAN,
  JOB_QUEUES.LAUNCH_FEE_DISTRIBUTE,
  JOB_QUEUES.LAUNCH_FEE_RECONCILE,
];
const standard = [
  JOB_QUEUES.PARTNER_METAPLEX_INDEX,
  JOB_QUEUES.PARTNER_FAIRSCALE_ASSESS,
  JOB_QUEUES.PARTNER_INFERENCE_REFRESH,
  JOB_QUEUES.PARTNER_JOBS_SYNC,
  JOB_QUEUES.MAINT_PERF_AGENT,
  JOB_QUEUES.MAINT_ACTIVITY_AGENT,
  JOB_QUEUES.MAINT_ENDPOINT_CHECK,
  JOB_QUEUES.MAINT_AGENT_DEACTIVATE_DUE,
  JOB_QUEUES.OPENROUTER_RECONCILE,
  JOB_QUEUES.BOUNTY_AUTO_RELEASE,
  JOB_QUEUES.LLM_DEPOSIT_EXPIRE,
  JOB_QUEUES.LLM_DEPOSIT_RECONCILE,
  JOB_QUEUES.ORDER_EXPIRE,
  JOB_QUEUES.ORDER_POST_ACTIVATION,
  JOB_QUEUES.NOTIFICATION_DELIVER,
  JOB_QUEUES.GITHUB_WEBHOOK_PROCESS,
  JOB_QUEUES.ANALYTICS_CONVERSION_TRACK,
  JOB_QUEUES.MESH_SIGNAL_FANOUT,
  JOB_QUEUES.MESH_WEBHOOK_DELIVER,
  JOB_QUEUES.AGENT_ACTIVITY_PERSIST,
  JOB_QUEUES.AGENT_SIGNALS_SYNC,
  JOB_QUEUES.MEMORY_EXTRACT,
  JOB_QUEUES.ALERT_EVALUATE,
  JOB_QUEUES.ALERT_WEBHOOK_DELIVER,
  JOB_QUEUES.REFERRAL_SUBSCRIPTION_QUALIFY,
  JOB_QUEUES.AGENT_SCHEDULE_EXECUTE,
];
const fanOut = new Set<string>([
  JOB_QUEUES.PARTNER_METAPLEX_INDEX,
  JOB_QUEUES.PARTNER_FAIRSCALE_ASSESS,
  JOB_QUEUES.PARTNER_INFERENCE_REFRESH,
  JOB_QUEUES.PARTNER_JOBS_SYNC,
  JOB_QUEUES.MAINT_PERF_AGENT,
  JOB_QUEUES.MAINT_ACTIVITY_AGENT,
  JOB_QUEUES.MAINT_ENDPOINT_CHECK,
  JOB_QUEUES.MAINT_AGENT_DEACTIVATE_DUE,
  JOB_QUEUES.OPENROUTER_RECONCILE,
  JOB_QUEUES.BOUNTY_AUTO_RELEASE,
  JOB_QUEUES.LLM_DEPOSIT_EXPIRE,
  JOB_QUEUES.LLM_DEPOSIT_RECONCILE,
  JOB_QUEUES.ORDER_EXPIRE,
  JOB_QUEUES.ORDER_POST_ACTIVATION,
  JOB_QUEUES.NOTIFICATION_DELIVER,
  JOB_QUEUES.GITHUB_WEBHOOK_PROCESS,
  JOB_QUEUES.ANALYTICS_CONVERSION_TRACK,
  JOB_QUEUES.MESH_SIGNAL_FANOUT,
  JOB_QUEUES.MESH_WEBHOOK_DELIVER,
  JOB_QUEUES.AGENT_ACTIVITY_PERSIST,
  JOB_QUEUES.AGENT_SIGNALS_SYNC,
  JOB_QUEUES.MEMORY_EXTRACT,
  JOB_QUEUES.ALERT_EVALUATE,
  JOB_QUEUES.ALERT_WEBHOOK_DELIVER,
  JOB_QUEUES.REFERRAL_SUBSCRIPTION_QUALIFY,
  JOB_QUEUES.AGENT_SCHEDULE_EXECUTE,
]);
const definitions: readonly QueueDefinition[] = [
  { name: JOB_QUEUES.DEAD_LETTER, policy: "standard", options: deadLetterOptions },
  ...exclusive.map((name): QueueDefinition => ({
    name,
    policy: "exclusive",
    options:
      name === JOB_QUEUES.LAUNCH_FEE_DISTRIBUTE || name === JOB_QUEUES.LAUNCH_FEE_RECONCILE
        ? { ...longRunning, retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 60 * 60, deleteAfterSeconds: 24 * 60 * 60 }
        : name === JOB_QUEUES.MAINT_PERF_SCAN
          ? longRunning
          : durable,
  })),
  ...standard.map((name): QueueDefinition => ({
    name,
    policy: "standard",
    options: name === JOB_QUEUES.LLM_DEPOSIT_RECONCILE
      ? { ...fixedDelayDurable, retryLimit: 120, retryDelay: 30, expireInSeconds: 2 * 60 * 60, deleteAfterSeconds: 24 * 60 * 60 }
      : name === JOB_QUEUES.MESH_WEBHOOK_DELIVER
        ? { ...durable, retryLimit: 8, retryDelay: 15, retryBackoff: true, retryDelayMax: 6 * 60 * 60, deleteAfterSeconds: 24 * 60 * 60 }
        : name === JOB_QUEUES.GITHUB_WEBHOOK_PROCESS
          ? { ...durable, retryLimit: 10, retryDelay: 15, retryBackoff: true, retryDelayMax: 60 * 60, expireInSeconds: 60 * 60, deleteAfterSeconds: 24 * 60 * 60 }
        : name === JOB_QUEUES.ALERT_WEBHOOK_DELIVER
          ? { ...durable, retryLimit: 8, retryDelay: 15, retryBackoff: true, retryDelayMax: 6 * 60 * 60, deleteAfterSeconds: 24 * 60 * 60 }
        : name === JOB_QUEUES.NOTIFICATION_DELIVER
          ? { ...durable, retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 6 * 60 * 60, deleteAfterSeconds: 24 * 60 * 60 }
          : fanOut.has(name)
            ? fanOutDurable
            : durable,
  })),
];
function assertApplicationQueueDefinitions(): void {
  assertPgBossQueueDefinitions(definitions);

  const definedNames = new Set(definitions.map((definition) => definition.name));
  for (const queueName of Object.values(JOB_QUEUES)) {
    if (!definedNames.has(queueName)) {
      throw new Error(`Application pg-boss queue is missing a policy definition: ${queueName}`);
    }
  }
}
function assertStructuralPolicy(
  definition: QueueDefinition,
  existing: QueueResult,
): void {
  if ((existing.policy ?? "standard") !== definition.policy) {
    throw new Error(
      `pg-boss queue policy drift for ${definition.name}: ${existing.policy ?? "standard"} != ${definition.policy}`,
    );
  }
  if (Boolean(existing.partition)) {
    throw new Error(
      `pg-boss queue partition drift for ${definition.name}: expected non-partitioned queue`,
    );
  }
}
export async function applyApplicationQueuePolicies(boss: PgBoss): Promise<void> {
  assertApplicationQueueDefinitions();
  const orderedDefinitions = orderPgBossQueueDefinitionsForCreation(definitions);
  const existingQueues = new Map(
    (await boss.getQueues(orderedDefinitions.map(({ name }) => name))).map(
      (queue) => [queue.name, queue],
    ),
  );
  for (const definition of orderedDefinitions) {
    const existing = existingQueues.get(definition.name);
    if (!existing) {
      await boss.createQueue(definition.name, {
        policy: definition.policy,
        ...asPgBossQueueOptions(definition.options),
      });
      continue;
    }
    assertStructuralPolicy(definition, existing);
    await boss.updateQueue(
      definition.name,
      asPgBossQueueOptions(definition.options),
    );
  }
  // Per-agent 90-day deactivation reminders were superseded by the predicate-based daily
  // stale-agent sweep. Deployment migration runs with workers stopped, so this is the safe
  // point to remove the obsolete deferred backlog accumulated by older releases.
  await boss.deleteQueuedJobs(JOB_QUEUES.MAINT_AGENT_DEACTIVATE_DUE);
}
export async function registerApplicationQueues(boss: PgBoss): Promise<void> {
  assertApplicationQueueDefinitions();
  const existingQueues = new Map(
    (await boss.getQueues(definitions.map(({ name }) => name))).map((queue) => [
      queue.name,
      queue,
    ]),
  );
  for (const definition of definitions) {
    const existing = existingQueues.get(definition.name);
    if (!existing) {
      throw new Error(`required pg-boss queue is missing: ${definition.name}`);
    }
    assertStructuralPolicy(definition, existing);
    assertPgBossQueueMatches(definition.name, existing, definition.options);
  }
}
