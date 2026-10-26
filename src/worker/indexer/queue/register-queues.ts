import type { PgBoss, QueuePolicy, QueueResult } from "pg-boss";
import {
  asPgBossQueueOptions,
  assertPgBossQueueDefinitions,
  assertPgBossQueueMatches,
  orderPgBossQueueDefinitionsForCreation,
  type PgBossQueueOptions,
} from "../../../jobs/queue-policy.js";
import { config } from "../config.js";
import { INDEXER_QUEUES } from "./queues.js";
import { indexerQueueExpireInSeconds } from "./job-timeouts.js";
type QueueDefinition = PgBossQueueOptions & {
  name: string;
  policy: QueuePolicy;
  partition?: boolean;
};
type EffectiveQueueDefinition = {
  name: string;
  policy: QueuePolicy;
  partition: boolean;
  options: PgBossQueueOptions;
};
const retryDelaySeconds = Math.max(1, Math.ceil(config.retryBaseMs / 1_000));
const retryLimit = Math.max(0, config.maxAttempts - 1);
// Successful fan-out work is materialized in domain tables. Retain only enough
// pg-boss history for short-lived operational inspection; the supervisor now
// runs deletion maintenance every ten minutes.
const FAN_OUT_DELETE_AFTER_SECONDS = 10 * 60;
export const INDEXER_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: INDEXER_QUEUES.BOOTSTRAP_ADVANCE,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.BOOTSTRAP_ADVANCE, 5 * 60),
    retentionSeconds: 7 * 24 * 60 * 60,
    deleteAfterSeconds: 3 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    notify: true,
    warningQueueSize: 5,
  },
  {
    name: INDEXER_QUEUES.DERIVED_FINALIZE,
    policy: "singleton",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.DERIVED_FINALIZE, 2 * 60 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    heartbeatSeconds: 60,
    notify: true,
    warningQueueSize: 5,
  },
  {
    name: INDEXER_QUEUES.DEAD_LETTER,
    policy: "standard",
    retryLimit: 0,
    retryDelay: 0,
    expireInSeconds: 900,
    retentionSeconds: 30 * 24 * 60 * 60,
    // registerDeadLetterWorker persists the durable record separately; the
    // pg-boss copy only needs a short recovery window after completion.
    deleteAfterSeconds: FAN_OUT_DELETE_AFTER_SECONDS,
    notify: true,
    warningQueueSize: 100,
  },
  {
    name: INDEXER_QUEUES.AGENT_METADATA,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.AGENT_METADATA, 10 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: FAN_OUT_DELETE_AFTER_SECONDS,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    warningQueueSize: 1_000,
  },
  {
    name: INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN, 10 * 60),
    retentionSeconds: 7 * 24 * 60 * 60,
    deleteAfterSeconds: 3 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    warningQueueSize: 5,
  },
  {
    name: INDEXER_QUEUES.AGENT_SYNC,
    policy: "standard",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.AGENT_SYNC, 10 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: FAN_OUT_DELETE_AFTER_SECONDS,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    notify: true,
    partition: true,
    warningQueueSize: 2_000,
  },
  {
    name: INDEXER_QUEUES.CLUSTER_RECONCILE,
    policy: "singleton",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.CLUSTER_RECONCILE, 15 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: FAN_OUT_DELETE_AFTER_SECONDS,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    warningQueueSize: 1_000,
  },
  {
    name: INDEXER_QUEUES.CATCHUP_SCAN,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.CATCHUP_SCAN, 10 * 60),
    retentionSeconds: 7 * 24 * 60 * 60,
    deleteAfterSeconds: 3 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    warningQueueSize: 5,
  },
  {
    name: INDEXER_QUEUES.VALIDATION_SCAN,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.VALIDATION_SCAN, 10 * 60),
    retentionSeconds: 7 * 24 * 60 * 60,
    deleteAfterSeconds: 3 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    warningQueueSize: 5,
  },
  {
    name: INDEXER_QUEUES.FEEDBACK_SCAN,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.FEEDBACK_SCAN, 10 * 60),
    retentionSeconds: 7 * 24 * 60 * 60,
    deleteAfterSeconds: 3 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    warningQueueSize: 5,
  },
  {
    name: INDEXER_QUEUES.CHAIN_CATCHUP,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.CHAIN_CATCHUP, 30 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    heartbeatSeconds: 60,
    warningQueueSize: 64,
  },
  {
    name: INDEXER_QUEUES.CHAIN_CATCHUP_RANGE,
    policy: "standard",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.CHAIN_CATCHUP_RANGE, 30 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: FAN_OUT_DELETE_AFTER_SECONDS,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    heartbeatSeconds: 60,
    notify: true,
    partition: true,
    warningQueueSize: 256,
  },
  {
    name: INDEXER_QUEUES.FEEDBACK_SYNC,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.FEEDBACK_SYNC, 30 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    warningQueueSize: 64,
  },
  {
    name: INDEXER_QUEUES.VALIDATION_SYNC,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.VALIDATION_SYNC, 30 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    warningQueueSize: 64,
  },
  {
    name: INDEXER_QUEUES.SOLANA_METADATA,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.SOLANA_METADATA, 10 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: FAN_OUT_DELETE_AFTER_SECONDS,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    // Solana metadata discovery intentionally runs ahead of best-effort fetches
    // during bootstrap; the observed steady backfill can exceed 500 without
    // indicating consumer failure.
    warningQueueSize: 1_500,
  },
  {
    name: INDEXER_QUEUES.SOLANA_8004_SNAPSHOT,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.SOLANA_8004_SNAPSHOT, 45 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    heartbeatSeconds: 60,
    notify: true,
    warningQueueSize: 10,
  },
  {
    name: INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, 15 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    heartbeatSeconds: 60,
    notify: true,
    // A scan generation can coexist with a bounded execution retry/continuation
    // set. Seven live rows is normal; warn only when that set grows materially.
    warningQueueSize: 16,
  },
  {
    name: INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC,
    policy: "standard",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, 20 * 60),
    retentionSeconds: 30 * 24 * 60 * 60,
    deleteAfterSeconds: FAN_OUT_DELETE_AFTER_SECONDS,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    heartbeatSeconds: 60,
    notify: true,
    partition: true,
    warningQueueSize: 1_000,
  },
  {
    name: INDEXER_QUEUES.METAPLEX_SNAPSHOT,
    policy: "stately",
    retryLimit,
    retryDelay: retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.METAPLEX_SNAPSHOT, 60 * 60),
    retentionSeconds: 14 * 24 * 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
    deadLetter: INDEXER_QUEUES.DEAD_LETTER,
    heartbeatSeconds: 60,
    notify: true,
    warningQueueSize: 10,
  },
  {
    name: INDEXER_QUEUES.SCORE_RECALCULATE, policy: "stately", retryLimit, retryDelay: retryDelaySeconds, retryBackoff: true, retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.SCORE_RECALCULATE, 10 * 60), retentionSeconds: 14 * 24 * 60 * 60, deleteAfterSeconds: FAN_OUT_DELETE_AFTER_SECONDS, deadLetter: INDEXER_QUEUES.DEAD_LETTER, warningQueueSize: 2_000,
  },
  {
    name: INDEXER_QUEUES.SCORE_REPAIR_SCAN, policy: "stately", retryLimit, retryDelay: retryDelaySeconds, retryBackoff: true, retryDelayMax: 15 * 60,
    expireInSeconds: indexerQueueExpireInSeconds(INDEXER_QUEUES.SCORE_REPAIR_SCAN, 10 * 60), retentionSeconds: 7 * 24 * 60 * 60, deleteAfterSeconds: 3 * 24 * 60 * 60, deadLetter: INDEXER_QUEUES.DEAD_LETTER, warningQueueSize: 5,
  },
];
function effectiveIndexerQueueDefinitions(): readonly EffectiveQueueDefinition[] {
  return INDEXER_QUEUE_DEFINITIONS.map((definition) => {
    const { name, policy, partition = false, ...configuredOptions } = definition;
    const options: PgBossQueueOptions =
      name === INDEXER_QUEUES.DEAD_LETTER
        ? configuredOptions
        : {
            ...configuredOptions,
            notify: true,
            heartbeatSeconds: configuredOptions.heartbeatSeconds ?? 60,
          };
    return { name, policy, partition, options };
  });
}
function assertStructuralPolicy(
  definition: EffectiveQueueDefinition,
  existing: QueueResult,
): void {
  if (
    (existing.policy ?? "standard") !== definition.policy ||
    Boolean(existing.partition) !== definition.partition
  ) {
    throw new Error(
      `pg-boss queue structural policy drift for ${definition.name}; manual queue maintenance is required`,
    );
  }
}
export async function applyIndexerQueuePolicies(
  boss: PgBoss,
): Promise<void> {
  const definitions = effectiveIndexerQueueDefinitions();
  assertPgBossQueueDefinitions(definitions);
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
        partition: definition.partition,
        ...asPgBossQueueOptions(definition.options),
      });
      continue;
    }
    if (
      (existing.policy ?? "standard") !== definition.policy ||
      Boolean(existing.partition) !== definition.partition
    ) {
      assertStructuralPolicy(definition, existing);
    }
    await boss.updateQueue(
      definition.name,
      asPgBossQueueOptions(definition.options),
    );
  }
}
export async function registerIndexerQueues(boss: PgBoss): Promise<void> {
  const definitions = effectiveIndexerQueueDefinitions();
  assertPgBossQueueDefinitions(definitions);
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
    assertPgBossQueueMatches(
      definition.name,
      existing,
      definition.options,
    );
  }
}
