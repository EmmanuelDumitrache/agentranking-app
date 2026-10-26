import type { Job, JobResult, JobWithMetadata, PgBoss, WorkOptions } from "pg-boss";
import {
  agentActivityPersistPayloadSchema,
  agentDeactivationDuePayloadSchema,
  conversionEventPayloadSchema,
  emptyJobPayloadSchema,
  githubWebhookPayloadSchema,
  endpointCheckPayloadSchema,
  fairscaleAssessmentPayloadSchema,
  inferenceProviderPayloadSchema,
  idPayloadSchema,
  launchFeeDistributionPayloadSchema,
  launchFeeReconcilePayloadSchema,
  launchFeeScanPayloadSchema,
  memoryExtractPayloadSchema,
  metaplexDiscoverPayloadSchema,
  metaplexIndexPayloadSchema,
  metaplexReindexPayloadSchema,
  numericIdPayloadSchema,
  partnerJobSyncPayloadSchema,
  subscriptionReferralPayloadSchema,
  type EmptyJobPayload,
} from "../../jobs/contracts";
import { JOB_QUEUES } from "../../jobs/queues";
import { agentScheduleExecutePayloadSchema } from "../../jobs/agent-schedule-contracts";
import { recomputeRanksJob } from "./tasks/recompute-ranks";
import { rankSnapshotJob } from "./tasks/rank-snapshot";
import { staleAgentSweepJob } from "./tasks/stale-agent-sweep";
import { robinhoodPreparationPruneJob } from "./tasks/robinhood-preparation-prune";
import { deactivateAgentDueJob } from "./tasks/deactivate-agent-due";
import { stakeSyncJob } from "./tasks/stake-sync";
import { agentChatReconcileJob } from "./tasks/agent-chat-reconcile";
import { partnerJobSourceSyncJob, partnerJobsSyncJob } from "./tasks/partner-jobs-sync";
import { hatcherSyncJob } from "./tasks/hatcher-sync";
import { inferenceProviderRefreshJob, inferenceProviderScanJob } from "./tasks/inference-providers";
import { fairscaleAssessmentJob, fairscaleScanJob } from "./tasks/fairscale";
import { x402DirectoryRefreshJob } from "./tasks/x402-directory";
import { sapSyncJob } from "./tasks/sap-sync";
import { openRouterBalanceSnapshotJob } from "./tasks/openrouter-balance-snapshot";
import { mcpCatalogRefreshJob } from "./tasks/mcp-catalog-refresh";
import { metaplexDiscoverJob, metaplexIndexJob, metaplexReindexJob } from "./tasks/metaplex";
import { endpointCheckJob, endpointChecksJob } from "./tasks/endpoint-checks";
import { hotAgentActivityAgentJob, hotAgentActivityJob } from "./tasks/hot-agent-activity";
import { perfSnapshotAgentJob, perfSnapshotsJob } from "./tasks/perf-snapshots";
import { subscriptionRemindersJob } from "./tasks/subscription-reminders";
import { openRouterReconciliationJob } from "./tasks/openrouter-reconciliation";
import { bountyAutoReleaseJob, expireLlmDepositJob, expireOrderJob, reconcileLlmDepositJob } from "./tasks/deferred-work";
import { deliverNotification } from "@/lib/notification-delivery";
import { trackConversionEventJob } from "./tasks/conversion-events";
import { processGithubWebhook } from "./tasks/github-webhook";
import { deliverMeshWebhook, fanoutMeshSignal } from "./tasks/mesh-delivery";
import { orderPostActivationJob } from "./tasks/order-post-activation";
import { syncDerivedSignalsForAgent } from "@/lib/signals/derive";
import { qualifySubscriptionReferral } from "./tasks/referral-subscription";
import { persistAgentActivityJob } from "./tasks/agent-activity-persist";
import { deliverAgentAlertWebhook, evaluateAgentAlertEvent } from "./tasks/agent-alerts";
import {
  agentLaunchFeeDistributionJob,
  agentLaunchFeeReconcileJob,
  agentLaunchFeeScanJob,
} from "./tasks/agent-launch-fees";
import { agentMemoryExtractJob } from "./tasks/agent-memory-extract";
import { dispatchMemoryExtractionOutbox } from "@/features/agent-memory/server/outbox";
import {
  agentScheduleExecuteJob,
  agentScheduleScanJob,
} from "./tasks/agent-schedules";
import {
  redactSensitiveData,
  safeErrorDetails,
} from "@/lib/security/sensitive-data-redaction";
import { createCompletionLogLimiter } from "../job-completion-log";
import { mapWithConcurrency } from "@/lib/async-pool";

const completedJobLog = createCompletionLogLimiter();
const failedJobLog = createCompletionLogLimiter();
const deadLetterJobLog = createCompletionLogLimiter();
const CLAIM_PREFETCH_WAVES = 4;
function applicationMaxInflight(): number {
  const raw = process.env.APPLICATION_WORKER_MAX_INFLIGHT?.trim();
  if (!raw) return 12;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error("APPLICATION_WORKER_MAX_INFLIGHT must be a positive integer");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("APPLICATION_WORKER_MAX_INFLIGHT must be a safe integer");
  }
  return Math.min(64, parsed);
}
const APPLICATION_MAX_INFLIGHT = applicationMaxInflight();
let applicationInflight = 0;
const applicationExecutionWaiters: Array<() => void> = [];
let applicationExecutionWaiterHead = 0;
function takeApplicationExecutionWaiter(): (() => void) | undefined {
  const next = applicationExecutionWaiters[applicationExecutionWaiterHead];
  if (!next) return undefined;
  applicationExecutionWaiterHead++;
  if (applicationExecutionWaiterHead === applicationExecutionWaiters.length) {
    applicationExecutionWaiters.length = 0;
    applicationExecutionWaiterHead = 0;
  }
  return next;
}
async function withApplicationExecutionSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (applicationInflight < APPLICATION_MAX_INFLIGHT) {
    applicationInflight++;
  } else {
    // A released slot is transferred directly to the oldest waiter; keeping
    // the active count unchanged prevents a newly-arriving job from stealing it.
    await new Promise<void>((resolve) => applicationExecutionWaiters.push(resolve));
  }
  try {
    return await operation();
  } finally {
    const next = takeApplicationExecutionWaiter();
    if (next) next();
    else applicationInflight--;
  }
}
const serial: WorkOptions = {
  localConcurrency: 1,
  batchSize: 1,
  priority: false,
  orderByCreatedOn: false,
  pollingIntervalSeconds: 2,
  notifyPollingIntervalSeconds: 30,
  heartbeatRefreshSeconds: 30,
};
function first<T>(jobs: Job<T>[]): Job<T> | null { return jobs[0] ?? null; }
async function runLogged<T>(queue: string, job: Job<unknown>, handler: () => Promise<T>): Promise<T> {
  return withApplicationExecutionSlot(async () => {
    const startedAt = Date.now();
    try {
      const result = await handler();
      const finishedAt = Date.now();
      const summary = completedJobLog(queue, finishedAt);
      if (summary) {
        console.info(`[jobs] ${queue} completed`, {
          ...summary,
          jobId: job.id,
          durationMs: finishedAt - startedAt,
          result: redactSensitiveData(result),
        });
      }
      return result;
    } catch (error) {
      const finishedAt = Date.now();
      const summary = failedJobLog(queue, finishedAt);
      if (summary) {
        console.error(`[jobs] ${queue} failed`, {
          ...summary,
          latestJobId: job.id,
          durationMs: finishedAt - startedAt,
          error: safeErrorDetails(error),
        });
      }
      throw error;
    }
  });
}
async function registerEmpty(boss: PgBoss, queue: string, handler: () => Promise<unknown>, options: WorkOptions = serial) {
  await boss.work<EmptyJobPayload>(queue, options, async (jobs) => {
    const job = first(jobs);
    if (!job) return undefined;
    emptyJobPayloadSchema.parse(job.data);
    return runLogged(queue, job, handler);
  });
}
async function registerBatched<T>(
  boss: PgBoss,
  queue: string,
  schema: { parse(value: unknown): T },
  handler: (payload: T) => Promise<unknown>,
  concurrency: number,
  overrides: WorkOptions = {},
): Promise<void> {
  // One pg-boss polling lane can feed several bounded execution waves. This
  // amortizes the claim/update round trip without raising application or DB
  // concurrency; pg-boss heartbeats the claimed batch while later waves wait.
  const handlerConcurrency = Math.max(1, Math.trunc(concurrency));
  const batchSize = Math.max(2, handlerConcurrency * CLAIM_PREFETCH_WAVES);
  const options = {
    ...serial,
    ...overrides,
    localConcurrency: 1,
    batchSize,
    perJobResults: true as const,
    burstWhenBatchFull: true,
  };
  await boss.work<unknown>(queue, options, async (jobs) =>
    mapWithConcurrency(jobs, handlerConcurrency, async (job) => {
      try {
        await runLogged(queue, job, () => handler(schema.parse(job.data)));
        // Domain state is the durable result. Avoid copying per-job success
        // payloads into the hottest pg-boss rows only to delete them an hour
        // later; failures retain their bounded diagnostic output below.
        return { id: job.id, status: "completed" as const };
      } catch (error) {
        return {
          id: job.id,
          status: "failed" as const,
          output: safeErrorDetails(error),
        };
      }
    })
  );
}
async function registerDeadLetterWorker(boss: PgBoss): Promise<void> {
  await boss.work<unknown>(
    JOB_QUEUES.DEAD_LETTER,
    {
      ...serial,
      includeMetadata: true,
      batchSize: 100,
      perJobResults: true,
      burstWhenBatchFull: true,
      pollingIntervalSeconds: 5,
    },
    async (jobs) => {
      const batch = jobs as JobWithMetadata<unknown>[];
      for (const job of batch) {
        const originalQueue = job.sourceName ?? "unknown";
        const summary = deadLetterJobLog(originalQueue);
        if (summary) {
          console.error("[jobs] retries exhausted", {
            ...summary,
            latestDeadLetterJobId: job.id,
            originalQueue,
            latestOriginalJobId: job.sourceId,
            retryCount: job.sourceRetryCount ?? job.retryCount,
            firstAttemptAt: job.sourceCreatedOn,
            latestError: redactSensitiveData(job.output),
          });
        }
      }
      return batch.map((job): JobResult => ({ id: job.id, status: "completed" }));
    },
  );
}
export async function registerApplicationWorkers(boss: PgBoss): Promise<void> {
  await registerDeadLetterWorker(boss);
  await registerEmpty(boss, JOB_QUEUES.MAINT_RECOMPUTE_RANKS, recomputeRanksJob);
  await registerEmpty(boss, JOB_QUEUES.MAINT_RANK_SNAPSHOT, rankSnapshotJob);
  await registerEmpty(boss, JOB_QUEUES.MAINT_STALE_AGENT_SWEEP, staleAgentSweepJob);
  await registerEmpty(boss, JOB_QUEUES.MAINT_ROBINHOOD_PREPARATION_PRUNE, robinhoodPreparationPruneJob);
  await registerBatched(
    boss,
    JOB_QUEUES.MAINT_AGENT_DEACTIVATE_DUE,
    agentDeactivationDuePayloadSchema,
    deactivateAgentDueJob,
    10,
  );
  await registerEmpty(boss, JOB_QUEUES.MAINT_STAKE_SYNC, stakeSyncJob);
  await registerEmpty(boss, JOB_QUEUES.CHAT_STALE_RUN_SCAN, agentChatReconcileJob);
  await registerEmpty(boss, JOB_QUEUES.MEMORY_OUTBOX_DISPATCH, dispatchMemoryExtractionOutbox);
  await registerEmpty(boss, JOB_QUEUES.AGENT_SCHEDULE_SCAN, agentScheduleScanJob);
  await registerBatched(boss, JOB_QUEUES.MEMORY_EXTRACT, memoryExtractPayloadSchema, agentMemoryExtractJob, 2);
  await registerEmpty(boss, JOB_QUEUES.PARTNER_JOBS_SCAN, partnerJobsSyncJob);
  await registerEmpty(boss, JOB_QUEUES.PARTNER_HATCHER_SYNC, hatcherSyncJob);
  await registerEmpty(boss, JOB_QUEUES.PARTNER_INFERENCE_SCAN, inferenceProviderScanJob);
  await registerEmpty(boss, JOB_QUEUES.PARTNER_FAIRSCALE_SCAN, fairscaleScanJob);
  await registerEmpty(boss, JOB_QUEUES.PARTNER_X402_DIRECTORY_REFRESH, x402DirectoryRefreshJob);
  await registerEmpty(boss, JOB_QUEUES.PARTNER_SAP_SYNC, sapSyncJob);
  await registerEmpty(boss, JOB_QUEUES.MAINT_OPENROUTER_BALANCE_SNAPSHOT, openRouterBalanceSnapshotJob);
  await registerEmpty(boss, JOB_QUEUES.MAINT_MCP_CATALOG_REFRESH, mcpCatalogRefreshJob);
  await registerEmpty(boss, JOB_QUEUES.MAINT_ENDPOINT_SCAN, endpointChecksJob);
  await registerEmpty(boss, JOB_QUEUES.MAINT_ACTIVITY_SCAN, hotAgentActivityJob);
  await registerEmpty(boss, JOB_QUEUES.MAINT_PERF_SCAN, perfSnapshotsJob);
  await registerEmpty(boss, JOB_QUEUES.SUBSCRIPTION_NOTIFICATION_SCAN, subscriptionRemindersJob);
  await boss.work(JOB_QUEUES.LAUNCH_FEE_SCAN, { ...serial, heartbeatRefreshSeconds: 30 }, async (jobs) => {
    const job = first(jobs); if (!job) return;
    const payload = launchFeeScanPayloadSchema.parse(job.data);
    return runLogged(JOB_QUEUES.LAUNCH_FEE_SCAN, job, () => agentLaunchFeeScanJob(payload));
  });
  await registerBatched(boss, JOB_QUEUES.PARTNER_FAIRSCALE_ASSESS, fairscaleAssessmentPayloadSchema, (payload) => fairscaleAssessmentJob(payload.agentDbId), 3);
  await registerBatched(boss, JOB_QUEUES.PARTNER_INFERENCE_REFRESH, inferenceProviderPayloadSchema, (payload) => inferenceProviderRefreshJob(payload.providerId), 8);
  await registerBatched(boss, JOB_QUEUES.PARTNER_JOBS_SYNC, partnerJobSyncPayloadSchema, (payload) => partnerJobSourceSyncJob(payload.source), 2);
  await registerBatched(boss, JOB_QUEUES.MAINT_PERF_AGENT, numericIdPayloadSchema, (payload) => perfSnapshotAgentJob(payload.id), 3);
  await registerBatched(boss, JOB_QUEUES.MAINT_ACTIVITY_AGENT, numericIdPayloadSchema, (payload) => hotAgentActivityAgentJob(payload.id), 3);
  await registerBatched(boss, JOB_QUEUES.MAINT_ENDPOINT_CHECK, endpointCheckPayloadSchema, (payload) => endpointCheckJob(payload.agentId, payload.serviceId), 10);
  await registerBatched(boss, JOB_QUEUES.OPENROUTER_RECONCILE, idPayloadSchema, (payload) => openRouterReconciliationJob(payload.id), 5);
  await registerBatched(boss, JOB_QUEUES.BOUNTY_AUTO_RELEASE, idPayloadSchema, (payload) => bountyAutoReleaseJob(payload.id), 8);
  await registerBatched(boss, JOB_QUEUES.LLM_DEPOSIT_EXPIRE, idPayloadSchema, (payload) => expireLlmDepositJob(payload.id), 5);
  await registerBatched(boss, JOB_QUEUES.LLM_DEPOSIT_RECONCILE, idPayloadSchema, (payload) => reconcileLlmDepositJob(payload.id), 3);
  await registerBatched(boss, JOB_QUEUES.ORDER_EXPIRE, idPayloadSchema, (payload) => expireOrderJob(payload.id), 5);
  await registerBatched(boss, JOB_QUEUES.ORDER_POST_ACTIVATION, idPayloadSchema, (payload) => orderPostActivationJob(payload.id), 5);
  await registerBatched(boss, JOB_QUEUES.NOTIFICATION_DELIVER, idPayloadSchema, (payload) => deliverNotification(payload.id), 8);
  await registerBatched(boss, JOB_QUEUES.GITHUB_WEBHOOK_PROCESS, githubWebhookPayloadSchema, processGithubWebhook, 4);
  await registerBatched(boss, JOB_QUEUES.ANALYTICS_CONVERSION_TRACK, conversionEventPayloadSchema, trackConversionEventJob, 10);
  await registerBatched(boss, JOB_QUEUES.MESH_SIGNAL_FANOUT, idPayloadSchema, (payload) => fanoutMeshSignal(payload.id), 5);
  await registerBatched(boss, JOB_QUEUES.MESH_WEBHOOK_DELIVER, idPayloadSchema, (payload) => deliverMeshWebhook(payload.id), 10);
  await registerBatched(boss, JOB_QUEUES.AGENT_ACTIVITY_PERSIST, agentActivityPersistPayloadSchema, persistAgentActivityJob, 5);
  await registerBatched(boss, JOB_QUEUES.AGENT_SIGNALS_SYNC, numericIdPayloadSchema, (payload) => syncDerivedSignalsForAgent(payload.id), 5);
  await registerBatched(boss, JOB_QUEUES.ALERT_EVALUATE, idPayloadSchema, (payload) => evaluateAgentAlertEvent(payload.id), 5);
  await registerBatched(boss, JOB_QUEUES.ALERT_WEBHOOK_DELIVER, idPayloadSchema, (payload) => deliverAgentAlertWebhook(payload.id), 10);
  await registerBatched(
    boss,
    JOB_QUEUES.REFERRAL_SUBSCRIPTION_QUALIFY,
    subscriptionReferralPayloadSchema,
    (payload) => qualifySubscriptionReferral(payload.providerEventId, payload.wallet, payload.email),
    5,
  );
  await registerBatched(
    boss,
    JOB_QUEUES.AGENT_SCHEDULE_EXECUTE,
    agentScheduleExecutePayloadSchema,
    (payload) => agentScheduleExecuteJob(payload.scheduleId, payload.scheduledFor),
    3,
  );
  await registerBatched(
    boss,
    JOB_QUEUES.LAUNCH_FEE_DISTRIBUTE,
    launchFeeDistributionPayloadSchema,
    (payload) => agentLaunchFeeDistributionJob(payload.id, payload.mode),
    2,
    { heartbeatRefreshSeconds: 30 },
  );
  await registerBatched(
    boss,
    JOB_QUEUES.LAUNCH_FEE_RECONCILE,
    launchFeeReconcilePayloadSchema,
    (payload) => agentLaunchFeeReconcileJob(payload.attemptId),
    2,
    { heartbeatRefreshSeconds: 30 },
  );
  await registerBatched(boss, JOB_QUEUES.PARTNER_METAPLEX_INDEX, metaplexIndexPayloadSchema, metaplexIndexJob, 3);
  await boss.work(JOB_QUEUES.PARTNER_METAPLEX_DISCOVER, serial, async (jobs) => {
    const job = first(jobs); if (!job) return;
    const payload = metaplexDiscoverPayloadSchema.parse(job.data);
    return runLogged(JOB_QUEUES.PARTNER_METAPLEX_DISCOVER, job, () => metaplexDiscoverJob(payload));
  });
  await boss.work(JOB_QUEUES.PARTNER_METAPLEX_REINDEX, serial, async (jobs) => {
    const job = first(jobs); if (!job) return;
    const payload = metaplexReindexPayloadSchema.parse(job.data);
    return runLogged(JOB_QUEUES.PARTNER_METAPLEX_REINDEX, job, () => metaplexReindexJob(payload));
  });
}
