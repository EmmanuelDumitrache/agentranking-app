import type { PgBoss, Schedule } from "pg-boss";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { INDEXER_PRIORITIES, INDEXER_QUEUES } from "./queues.js";
import { WORKER_SEMANTIC_GENERATION } from "./semantic-generation.js";
import { enqueueBootstrapAdvance } from "./producer.js";
const SCHEDULE_PREFIX = "worker.";
const SCHEDULE_TIMEZONE = "Etc/UTC";
type WantedSchedule = {
  queue: string;
  key: string;
  cron: string;
  priority: number;
  data: Record<string, unknown>;
};
async function reconcileQueueSchedules(
  boss: PgBoss,
  queue: string,
  wanted: WantedSchedule[],
  existing: Schedule[],
): Promise<void> {
  const wantedKeys = new Set(wanted.map((entry) => entry.key));
  await Promise.all([
    ...existing
      .filter(
        (schedule: Schedule) =>
          schedule.key.startsWith(SCHEDULE_PREFIX) && !wantedKeys.has(schedule.key),
      )
      .map((schedule: Schedule) => boss.unschedule(queue, schedule.key)),
    ...wanted.map((schedule) =>
      boss.schedule(
        schedule.queue,
        schedule.cron,
        schedule.data,
        {
          key: schedule.key,
          priority: schedule.priority,
          tz: SCHEDULE_TIMEZONE,
        },
      )
    ),
  ]);
}
export async function registerIndexerSchedules(
  boss: PgBoss,
  options: { enqueueStartupWork?: boolean } = {},
): Promise<void> {
  const schedules: WantedSchedule[] = [
    {
      queue: INDEXER_QUEUES.BOOTSTRAP_ADVANCE,
      key: `${SCHEDULE_PREFIX}bootstrap-advance`,
      cron: "* * * * *",
      priority: INDEXER_PRIORITIES.BOOTSTRAP_ADVANCE,
      data: { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION, reason: "scheduled-safety-net" },
    },
    {
      queue: INDEXER_QUEUES.CATCHUP_SCAN,
      key: `${SCHEDULE_PREFIX}catchup-scan`,
      cron: config.catchupCron,
      priority: INDEXER_PRIORITIES.CATCHUP_SCAN,
      data: { v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION },
    },
    {
      queue: INDEXER_QUEUES.VALIDATION_SCAN,
      key: `${SCHEDULE_PREFIX}validation-scan`,
      cron: config.validationSyncCron,
      priority: INDEXER_PRIORITIES.VALIDATION_SCAN,
      data: { v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION },
    },
    {
      queue: INDEXER_QUEUES.FEEDBACK_SCAN,
      key: `${SCHEDULE_PREFIX}feedback-scan`,
      cron: config.feedbackSyncCron,
      priority: INDEXER_PRIORITIES.FEEDBACK_SCAN,
      data: { v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION },
    },
    {
      queue: INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN,
      key: `${SCHEDULE_PREFIX}registration-refresh`,
      cron: process.env.WORKER_REGISTRATION_REFRESH_CRON?.trim() || "*/15 * * * *",
      priority: INDEXER_PRIORITIES.REGISTRATION_REFRESH_SCAN,
      data: { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION },
    },
    {
      queue: INDEXER_QUEUES.SCORE_REPAIR_SCAN,
      key: `${SCHEDULE_PREFIX}score-repair`,
      cron: process.env.WORKER_SCORE_REPAIR_CRON?.trim() || "17 */6 * * *",
      priority: INDEXER_PRIORITIES.SCORE_REPAIR_SCAN,
      data: { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION },
    },
    {
      queue: INDEXER_QUEUES.SOLANA_8004_SNAPSHOT,
      key: `${SCHEDULE_PREFIX}solana`,
      cron: config.solana8004SnapshotCron,
      priority: INDEXER_PRIORITIES.SOLANA_8004_SNAPSHOT,
      data: { v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION },
    },
    {
      queue: INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN,
      key: `${SCHEDULE_PREFIX}solana-8004-trust`,
      cron: config.solana8004TrustCron,
      priority: INDEXER_PRIORITIES.SOLANA_8004_TRUST_SCAN,
      data: { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION },
    },
    {
      queue: INDEXER_QUEUES.METAPLEX_SNAPSHOT,
      key: `${SCHEDULE_PREFIX}metaplex-snapshot`,
      cron: config.metaplexSnapshotCron,
      priority: INDEXER_PRIORITIES.METAPLEX_SNAPSHOT,
      data: { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION },
    },
  ];
  const queues = [
    INDEXER_QUEUES.BOOTSTRAP_ADVANCE,
    INDEXER_QUEUES.CATCHUP_SCAN,
    INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN,
    INDEXER_QUEUES.VALIDATION_SCAN,
    INDEXER_QUEUES.FEEDBACK_SCAN,
    INDEXER_QUEUES.SOLANA_8004_SNAPSHOT,
    INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN,
    INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC,
    INDEXER_QUEUES.METAPLEX_SNAPSHOT,
    INDEXER_QUEUES.SCORE_REPAIR_SCAN,
    INDEXER_QUEUES.CHAIN_CATCHUP,
    INDEXER_QUEUES.CHAIN_CATCHUP_RANGE,
    INDEXER_QUEUES.VALIDATION_SYNC,
    INDEXER_QUEUES.FEEDBACK_SYNC,
  ];
  const existingSchedules = await boss.getSchedules();
  await Promise.all(queues.map((queue) =>
    reconcileQueueSchedules(
      boss,
      queue,
      schedules.filter((entry) => entry.queue === queue),
      existingSchedules.filter((schedule) => schedule.name === queue),
    )
  ));
  const enqueueStartupWork = options.enqueueStartupWork !== false;
  if (enqueueStartupWork) {
    await enqueueBootstrapAdvance({ reason: "worker-startup" });
  }
  logger.info(
    "pg-boss indexer schedules registered",
    {
      catchupCron: config.catchupCron,
      validationCron: config.validationSyncCron,
      feedbackCron: config.feedbackSyncCron,
      registrationRefreshCron: process.env.WORKER_REGISTRATION_REFRESH_CRON?.trim() || "*/15 * * * *",
      solana8004SnapshotCron: config.solana8004SnapshotCron,
      solana8004TrustCron: config.solana8004TrustCron,
      metaplexSnapshotCron: config.metaplexSnapshotCron,
      scoreRepairCron: process.env.WORKER_SCORE_REPAIR_CRON?.trim() || "17 */6 * * *",
      startupWakeup: enqueueStartupWork,
    },
    "queue",
  );
}
