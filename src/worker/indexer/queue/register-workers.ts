import { createHash } from "node:crypto";
import type { Job, JobResult, PgBoss, WorkOptions } from "pg-boss";
import { createCompletionLogLimiter } from "../../job-completion-log.js";
import { mapWithConcurrency } from "@/lib/async-pool";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { indexerRelationWriteConcurrency, indexerWorkerClaimConcurrency, indexerWriteHeavyConcurrency, prisma, workerPrismaPoolSize } from "../db.js";
import { runAgentSyncJob } from "../jobs/agentSyncJob.js";
import { runAgentMetadataJob } from "../jobs/agentMetadataJob.js";
import { runRegistrationRefreshScan } from "../jobs/registrationRefreshScanJob.js";
import { runCatchupJob } from "../jobs/catchupJob.js";
import { runIdentityRangeJob } from "../jobs/identityRangeJob.js";
import { runClusterReconcileJob } from "../jobs/clusterReconcileJob.js";
import { runFeedbackSyncJob } from "../jobs/feedbackSyncJob.js";
import { runSolana8004SnapshotJob } from "../jobs/solana8004SnapshotJob.js";
import { runSolana8004TrustScanJob } from "../jobs/solana8004TrustScanJob.js";
import { runSolana8004TrustSyncJob } from "../jobs/solana8004TrustSyncJob.js";
import { runMetaplexSnapshotJob } from "../jobs/metaplexSnapshotJob.js";
import { runSolanaMetadataJob } from "../jobs/solanaMetadataJob.js";
import { runValidationSyncJob } from "../jobs/validationSyncJob.js";
import { runScoreRecalculateJob } from "../jobs/scoreRecalculateJob.js";
import { runScoreRepairScan } from "../jobs/scoreRepairScanJob.js";
import { runDerivedFinalizeJob } from "../sync/derived-bootstrap.js";
import {
  SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS,
  Solana8004TrustRetryDeferredError,
} from "../sync/solana-8004/trust-queue-policy.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import { getSyncableChainIds, redactRpcErrorText, rpcDeferredDetail, rpcDeferredReason, type RpcDeferredReason } from "../sync/rpc.js";
import {
  agentSyncPayloadSchema,
  agentMetadataPayloadSchema,
  registrationRefreshScanPayloadSchema,
  chainCatchupPayloadSchema,
  identityRangePayloadSchema,
  indexerScanPayloadSchema,
  feedbackSyncPayloadSchema,
  solana8004SnapshotPayloadSchema,
  solana8004TrustScanPayloadSchema,
  solana8004TrustSyncPayloadSchema,
  metaplexSnapshotPayloadSchema,
  solanaMetadataPayloadSchema,
  validationSyncPayloadSchema,
  clusterReconcilePayloadSchema,
  scoreRecalculatePayloadSchema,
  scoreRepairScanPayloadSchema,
  bootstrapAdvancePayloadSchema,
  derivedFinalizePayloadSchema,
  type AgentSyncPayload,
  type AgentMetadataPayload,
  type RegistrationRefreshScanPayload,
  type ChainCatchupPayload,
  type IdentityRangePayload,
  type FeedbackSyncPayload,
  type IndexerScanPayload,
  type Solana8004SnapshotPayload,
  type Solana8004TrustScanPayload,
  type Solana8004TrustSyncPayload,
  type MetaplexSnapshotPayload,
  type SolanaMetadataPayload,
  type ValidationSyncPayload,
  type ClusterReconcilePayload,
  type ScoreRecalculatePayload,
  type ScoreRepairScanPayload,
  type BootstrapAdvancePayload,
  type DerivedFinalizePayload,
} from "./contracts.js";
import { INDEXER_QUEUES } from "./queues.js";
import { INDEXER_JOB_TIMEOUT_MS } from "./job-timeouts.js";
import { BusinessExecutionInProgressError, createOrReadJobExecutionContext, type JobExecutionContext } from "./job-context.js";
import { registerDeadLetterWorker } from "./dead-letter.js";
import { runWithJobRuntime } from "./retry-budget.js";
import { createDefaultRetryBudget } from "./retry-budget-default.js";
import { recordSyncOutcome } from "./sync-outcome.js";
import { isStaleSemanticGeneration, WORKER_SEMANTIC_GENERATION } from "./semantic-generation.js";
import { currentEvmSourceDescriptor, type EvmSourceDomain } from "../lib/source-descriptor.js";
import { WORKER_CONFIGURATION_GENERATION as SOURCE_CONFIGURATION_GENERATION } from "../lib/source-cursor.js";
import { runBootstrapAdvance } from "./bootstrap-coordinator.js";
import { isBootstrapPhaseOpen, DERIVED_SCORE_SOURCE_KEY, METAPLEX_IDENTITY_SOURCE_KEY, REGISTRATION_METADATA_SOURCE_KEY, SOLANA_8004_IDENTITY_SOURCE_KEY, SOLANA_8004_TRUST_SOURCE_KEY } from "./bootstrap-state.js";
import { recordBootstrapSourceProgress } from "./bootstrap-progress.js";
import {
  acknowledgeScanWakeup,
  enqueueBootstrapAdvance,
  acknowledgeSolanaScanWakeup,
  acknowledgeSourceScanWakeup,
  enqueueAgentSync,
  enqueueAgentSyncExecutionRetry,
  enqueueAgentMetadataHydration,
  enqueueRegistrationRefreshScan,
  enqueueCatchupScan,
  enqueueClusterReconcile,
  enqueueFeedbackScan,
  enqueueSolanaMetadataHydration,
  enqueueSolana8004Snapshot,
  enqueueSolana8004TrustScan,
  enqueueSolana8004TrustScanExecutionRetry,
  enqueueSolana8004TrustSyncBatch,
  acknowledgeSolana8004TrustScanWakeup,
  enqueueMetaplexSnapshot,
  enqueueValidationScan,
  enqueueChainCatchup,
  enqueueChainCatchupWakeup,
  enqueueIdentityRangeLeases,
  enqueueFeedbackSync,
  enqueueFeedbackSyncBatch,
  enqueueValidationSync,
  registerScheduledScanIntent,
  requestSourceScanContinuation,
  enqueueScoreRecalculation,
  enqueueScoreRepairScan,
} from "./producer.js";
// These handlers are idempotent and already run concurrently; producer priority is
// fixed per named queue, so sorting a deep ready set cannot change useful ordering.
const UNSORTED_CLAIM_OPTIONS = {
  priority: false,
  orderByCreatedOn: false,
  perJobResults: true,
} as const satisfies Pick<WorkOptions, "priority" | "orderByCreatedOn" | "perJobResults">;
function indexerMaxInflight(): number {
  const raw = process.env.WORKER_JOB_MAX_INFLIGHT?.trim();
  if (!raw) {
    return Math.max(4, Math.min(12, Math.floor(workerPrismaPoolSize * 2 / 3)));
  }
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error("WORKER_JOB_MAX_INFLIGHT must be a positive integer");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("WORKER_JOB_MAX_INFLIGHT must be a safe integer");
  }
  return Math.min(64, parsed);
}
const INDEXER_MAX_INFLIGHT = indexerMaxInflight();
const INDEXER_EXECUTION_ADMISSION_TIMEOUT_MS = 5 * 60_000;
type IndexerExecutionWaiter = {
  active: boolean;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
};
let indexerInflight = 0;
const indexerExecutionWaiters: IndexerExecutionWaiter[] = [];
let indexerExecutionWaiterHead = 0;
function takeIndexerExecutionWaiter(): (() => void) | undefined {
  while (indexerExecutionWaiterHead < indexerExecutionWaiters.length) {
    const waiter = indexerExecutionWaiters[indexerExecutionWaiterHead++];
    if (!waiter?.active) continue;
    waiter.active = false;
    clearTimeout(waiter.timeout);
    if (indexerExecutionWaiterHead === indexerExecutionWaiters.length) {
      indexerExecutionWaiters.length = 0;
      indexerExecutionWaiterHead = 0;
    }
    return waiter.resolve;
  }
  indexerExecutionWaiters.length = 0;
  indexerExecutionWaiterHead = 0;
  return undefined;
}
async function waitForIndexerExecutionSlot(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const waiter: IndexerExecutionWaiter = {
      active: true,
      resolve,
      timeout: setTimeout(() => {
        if (!waiter.active) return;
        waiter.active = false;
        reject(new Error(
          `indexer execution admission exceeded ${INDEXER_EXECUTION_ADMISSION_TIMEOUT_MS}ms`,
        ));
      }, INDEXER_EXECUTION_ADMISSION_TIMEOUT_MS),
    };
    waiter.timeout.unref?.();
    indexerExecutionWaiters.push(waiter);
  });
}
async function withIndexerExecutionSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (indexerInflight < INDEXER_MAX_INFLIGHT) {
    indexerInflight++;
  } else {
    // pg-boss can abandon its outer handler when expireInSeconds elapses, but
    // that does not cancel an arbitrary Promise queued in this semaphore. Bound
    // admission so a stale waiter cannot wake up after pg-boss has retried it.
    await waitForIndexerExecutionSlot();
  }
  try {
    return await operation();
  } finally {
    const next = takeIndexerExecutionWaiter();
    if (next) next();
    else indexerInflight--;
  }
}
function batchedClaimLayout(concurrency: number) {
  const boundedConcurrency = Math.max(1, Math.trunc(concurrency));
  return {
    // Keep claims independent. A pg-boss batch is settled only after the batch
    // callback returns, so one slow member otherwise leaves already-finished
    // siblings active until they hit the handler expiry. Parallel one-row lanes
    // preserve queue concurrency while allowing each job to settle immediately.
    workerLanes: boundedConcurrency,
    handlerConcurrency: 1,
    batchSize: 1,
  };
}
function batchedClaimOptions(concurrency: number) {
  const { workerLanes, batchSize } = batchedClaimLayout(concurrency);
  return {
    ...UNSORTED_CLAIM_OPTIONS,
    localConcurrency: workerLanes,
    batchSize,
    burstWhenBatchFull: true,
  };
}
const RPC_PRIORITY: Record<string, number> = {
  [INDEXER_QUEUES.AGENT_SYNC]: 100,
  [INDEXER_QUEUES.AGENT_METADATA]: 80,
  [INDEXER_QUEUES.CLUSTER_RECONCILE]: 40,
  [INDEXER_QUEUES.VALIDATION_SYNC]: 30,
  [INDEXER_QUEUES.CHAIN_CATCHUP]: 20,
  [INDEXER_QUEUES.CHAIN_CATCHUP_RANGE]: 25,
  [INDEXER_QUEUES.FEEDBACK_SYNC]: 10,
  [INDEXER_QUEUES.SOLANA_8004_SNAPSHOT]: 20,
  [INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN]: 15,
  [INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC]: 10,
  [INDEXER_QUEUES.METAPLEX_SNAPSHOT]: 20,
  [INDEXER_QUEUES.SOLANA_METADATA]: 50,
};
const WORKER_DECODER_GENERATION = process.env.INDEXER_DECODER_GENERATION?.trim() || "worker-protocol-v13";
const WORKER_CONFIGURATION_GENERATION = SOURCE_CONFIGURATION_GENERATION;

const METADATA_DEFERRED_LOG_INTERVAL_MS = 60_000;
const metadataDeferredLogState = new Map<string, { lastLoggedAt: number; suppressed: number }>();
const repetitiveEventLog = createCompletionLogLimiter();
const failedJobLog = createCompletionLogLimiter();
const deferredJobLog = createCompletionLogLimiter();

function repetitiveEventSummary(key: string): { occurrencesSinceLastLog: number; windowMs: number } | null {
  const summary = repetitiveEventLog(key);
  return summary
    ? { occurrencesSinceLastLog: summary.completedSinceLastLog, windowMs: summary.windowMs }
    : null;
}

function logMetadataDeferred(params: {
  queue: string;
  jobId: string;
  chainId: number;
}): void {
  const now = Date.now();
  const state = metadataDeferredLogState.get(params.queue);
  if (state && now - state.lastLoggedAt < METADATA_DEFERRED_LOG_INTERVAL_MS) {
    state.suppressed += 1;
    return;
  }
  const suppressedSinceLast = state?.suppressed ?? 0;
  metadataDeferredLogState.set(params.queue, { lastLoggedAt: now, suppressed: 0 });
  logger.warn(
    "metadata jobs deferred",
    {
      queue: params.queue,
      latestJobId: params.jobId,
      chainId: params.chainId,
      reason: "metadata_unavailable",
      suppressedSinceLast,
    },
    "queue",
  );
}

function opaqueBusinessComponent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const WAKEUP_ENQUEUE_COALESCE_MS = 25;
const wakeupEnqueues = new Map<string, Promise<unknown>>();

async function enqueueCoalescedWakeup(key: string, enqueue: () => Promise<unknown>): Promise<void> {
  const current = wakeupEnqueues.get(key);
  if (current) {
    await current;
    return;
  }
  const pending = (async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, WAKEUP_ENQUEUE_COALESCE_MS));
    await enqueue();
  })();
  wakeupEnqueues.set(key, pending);
  try {
    await pending;
  } finally {
    if (wakeupEnqueues.get(key) === pending) wakeupEnqueues.delete(key);
  }
}

async function replaceStaleEvmSourceJob(
  queue: string,
  payload: { chainId: number; registryAddress?: string; registryGeneration?: string; configurationGeneration?: string },
  domain: EvmSourceDomain,
): Promise<boolean> {
  const current = currentEvmSourceDescriptor(payload.chainId, domain);
  const compatible = payload.registryAddress?.toLowerCase() === current.registryAddress.toLowerCase()
    && payload.registryGeneration === current.registryGeneration
    && payload.configurationGeneration === current.configurationGeneration;
  if (compatible) return false;
  const logSummary = repetitiveEventSummary(`stale-source:${queue}:${payload.chainId}`);
  if (logSummary) {
    logger.warn("replacing stale source-generation jobs", {
      ...logSummary,
      queue, chainId: payload.chainId, domain,
      payloadRegistry: payload.registryAddress ? "configured" : "missing",
      payloadGeneration: payload.registryGeneration,
      currentGeneration: current.registryGeneration,
    }, "queue");
  }
  await enqueueCoalescedWakeup(`stale-source:${domain}:${payload.chainId}`, () => {
    if (domain === "identity") {
      return enqueueChainCatchup({ chainId: payload.chainId, maxBlocks: config.evmIdentityRangeBlocks });
    }
    if (domain === "reputation") return enqueueFeedbackSync({ chainId: payload.chainId });
    return enqueueValidationSync({ chainId: payload.chainId, maxBlocks: config.catchupMaxBlocks });
  });
  return true;
}
async function replaceStaleSemanticJob(queue: string, payload: Record<string, unknown>): Promise<boolean> {
  const generation = typeof payload.semanticGeneration === "string" ? payload.semanticGeneration : undefined;
  if (!isStaleSemanticGeneration(generation)) return false;
  const logSummary = repetitiveEventSummary(`stale-semantic:${queue}`);
  if (logSummary) {
    logger.warn("replacing stale semantic-generation jobs", {
      ...logSummary,
      queue,
      payloadGeneration: generation,
      currentGeneration: WORKER_SEMANTIC_GENERATION,
    }, "queue");
  }
  if (queue === INDEXER_QUEUES.AGENT_SYNC) {
    await enqueueAgentSync({
      chainId: Number(payload.chainId),
      agentId: String(payload.agentId),
      source: typeof payload.source === "string" ? payload.source : "semantic-generation-replacement",
      sourceSnapshot: payload.sourceSnapshot as never,
    });
  } else if (queue === INDEXER_QUEUES.AGENT_METADATA) {
    await enqueueAgentMetadataHydration({
      chainId: Number(payload.chainId),
      agentId: String(payload.agentId),
      uri: String(payload.uri),
    });
  } else if (queue === INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN) {
    await enqueueRegistrationRefreshScan();
  } else if (queue === INDEXER_QUEUES.CLUSTER_RECONCILE) {
    await enqueueClusterReconcile({
      chainId: Number(payload.chainId),
      agentId: Number(payload.agentId),
      sourceObservationKey: typeof payload.sourceObservationKey === "string" ? payload.sourceObservationKey : undefined,
    });
  } else if (queue === INDEXER_QUEUES.CHAIN_CATCHUP) {
    await enqueueChainCatchup({
      chainId: Number(payload.chainId),
      maxBlocks: typeof payload.maxBlocks === "number" ? payload.maxBlocks : undefined,
      continuationFromBlock: typeof payload.continuationFromBlock === "string" ? payload.continuationFromBlock : undefined,
    });
  } else if (queue === INDEXER_QUEUES.CHAIN_CATCHUP_RANGE) {
    const chainId = Number(payload.chainId);
    const requestedGeneration = typeof payload.requestedGeneration === "string" ? payload.requestedGeneration : undefined;
    await enqueueCoalescedWakeup(
      `chain-catchup:${chainId}:${requestedGeneration ?? "none"}:1`,
      () => enqueueChainCatchupWakeup({
        chainId,
        requestedGeneration,
        maxBlocks: config.evmIdentityRangeBlocks,
      }, { startAfter: 1 }),
    );
  } else if (queue === INDEXER_QUEUES.FEEDBACK_SYNC) {
    await enqueueFeedbackSync({ chainId: Number(payload.chainId) });
  } else if (queue === INDEXER_QUEUES.VALIDATION_SYNC) {
    await enqueueValidationSync({
      chainId: Number(payload.chainId),
      maxBlocks: typeof payload.maxBlocks === "number" ? payload.maxBlocks : undefined,
      continuationFromBlock: typeof payload.continuationFromBlock === "string" ? payload.continuationFromBlock : undefined,
    });
  } else if (queue === INDEXER_QUEUES.SOLANA_8004_SNAPSHOT) {
    await enqueueSolana8004Snapshot();
  } else if (queue === INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN) {
    await enqueueSolana8004TrustScan();
  } else if (queue === INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC) {
    const signature = String(payload.signature);
    // A stale pg-boss delivery may already own the durable QUEUED reservation.
    // Release it before asking the current producer to materialize a replacement.
    await prisma.solana8004TrustSignature.updateMany({
      where: { signature, status: "QUEUED" },
      data: { status: "PENDING" },
    });
    await enqueueSolana8004TrustSyncBatch([{ signature, slot: String(payload.slot) }]);
  } else if (queue === INDEXER_QUEUES.METAPLEX_SNAPSHOT) {
    await enqueueMetaplexSnapshot();
  } else if (queue === INDEXER_QUEUES.SOLANA_METADATA) {
    await enqueueSolanaMetadataHydration({ asset: String(payload.asset), uri: String(payload.uri) });
  } else if (queue === INDEXER_QUEUES.SCORE_RECALCULATE) {
    await enqueueScoreRecalculation(Number(payload.agentId));
  } else if (queue === INDEXER_QUEUES.SCORE_REPAIR_SCAN) {
    await enqueueScoreRepairScan(typeof payload.afterAgentId === "number" ? payload.afterAgentId : undefined);
  } else if (queue === INDEXER_QUEUES.CATCHUP_SCAN) {
    await enqueueCatchupScan();
  } else if (queue === INDEXER_QUEUES.FEEDBACK_SCAN) {
    await enqueueFeedbackScan();
  } else if (queue === INDEXER_QUEUES.VALIDATION_SCAN) {
    await enqueueValidationScan();
  } else {
    throw new Error(`cannot replace stale semantic-generation payload for queue ${queue}`);
  }
  return true;
}
async function executeDurably<T, R>(input: {
  queue: string;
  job: Job<T>;
  businessKey: string;
  payloadGeneration: number;
  sourceSnapshot?: unknown;
  decoderGeneration?: string;
  configurationGeneration?: string;
  rpcPriority?: number;
  onExecutionInProgress?: (error: BusinessExecutionInProgressError) => R | Promise<R>;
  operation: (signal: AbortSignal, checkpoint: (progress: Record<string, unknown>) => Promise<void>) => Promise<R>;
}): Promise<R> {
  const timeoutMs = INDEXER_JOB_TIMEOUT_MS[input.queue] ?? 10 * 60_000;
  const execute = async (): Promise<R> => {
    let context: JobExecutionContext;
    try {
      const start = await createOrReadJobExecutionContext<T, R>({
        queueName: input.queue,
        job: input.job,
        businessKey: input.businessKey,
        payloadGeneration: input.payloadGeneration,
        sourceSnapshot: input.sourceSnapshot,
        decoderGeneration: input.decoderGeneration ?? WORKER_DECODER_GENERATION,
        configurationGeneration: input.configurationGeneration ?? WORKER_CONFIGURATION_GENERATION,
        timeoutMs,
      });
      if (start.completed) return start.result;
      context = start.context;
    } catch (error) {
      if (error instanceof BusinessExecutionInProgressError && input.onExecutionInProgress) {
        return input.onExecutionInProgress(error);
      }
      throw error;
    }
    try {
      const retryBudget = createDefaultRetryBudget();
      const result = await runWithJobRuntime({
        queueName: input.queue,
        signal: context.signal,
        rpcPriority: input.rpcPriority ?? RPC_PRIORITY[input.queue] ?? 0,
        retryBudget,
        touchProgress: context.touch,
      }, () => input.operation(context.signal, context.checkpoint));
      const deferredReason = result != null && typeof result === "object"
        ? Reflect.get(result, "deferredReason")
        : undefined;
      await context.complete(result, {
        allowAborted: context.signal.aborted && deferredReason === "job_timeout",
      });
      return result;
    } catch (error) {
      try {
        await context.fail(error);
      } catch (persistenceError) {
        logger.error(
          "failed to persist indexer job failure state",
          {
            queue: input.queue,
            jobId: input.job.id,
            businessKey: input.businessKey,
            originalError: redactRpcErrorText(error instanceof Error ? error.message : String(error)),
            persistenceError: redactRpcErrorText(
              persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
            ),
          },
          "queue",
        );
      }
      throw error;
    }
  };
  return execute();
}
function isExpectedAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = Reflect.get(error, "name");
  const message = Reflect.get(error, "message");
  return name === "AbortError" || (typeof message === "string" && /operation was aborted/i.test(message));
}
function logFailure(queue: string, jobId: string, chainId: number | undefined, error: unknown): void {
  const interrupted = isExpectedAbort(error);
  const summary = failedJobLog(`${queue}:${interrupted ? "interrupted" : "failed"}`);
  if (!summary) return;
  const data = {
    queue,
    latestJobId: jobId,
    chainId,
    occurrencesSinceLastLog: summary.completedSinceLastLog,
    windowMs: summary.windowMs,
    error: redactRpcErrorText(error instanceof Error ? error.message : String(error)),
    stack: error instanceof Error ? redactRpcErrorText(error.stack?.slice(0, 1_000) ?? "") : undefined,
    cause: error instanceof Error && error.cause != null ? redactRpcErrorText(String(error.cause)) : undefined,
  };
  if (interrupted) {
    logger.info("pg-boss job interrupted", data, "queue");
    return;
  }
  logger.error("pg-boss job failed", data, "queue");
}
const completedJobLog = createCompletionLogLimiter();
function logJobCompleted(queue: string, details: Record<string, unknown>): void {
  const summary = completedJobLog(queue);
  if (!summary) return;
  logger.info("jobs completed", { queue, ...summary, ...details }, "queue");
}
function businessExecutionRetryAt(error: BusinessExecutionInProgressError): Date {
  // The durable execution aborts at its deadline. Leave a small boundary cushion
  // so a replacement cannot race the prior handler's deadline timer or lease fence.
  return new Date(Math.max(Date.now() + 1_000, error.retryAt.getTime() + 1_000));
}

const RPC_EXECUTION_RETRY_DELAY_MS: Readonly<Record<RpcDeferredReason, number>> = {
  rpc_finality_quorum_unavailable: 60_000,
  rpc_provider_lag: 60_000,
  rpc_block_unavailable: 60_000,
  rpc_archive_unavailable: 5 * 60_000,
  rpc_rate_limited: 2 * 60_000,
  rpc_retry_budget_exhausted: 2 * 60_000,
  rpc_transport_unavailable: 60_000,
  job_timeout: 60_000,
};

function rpcExecutionDeferral(
  error: unknown,
  minimumDelayMs = 0,
  jitter = true,
): { reason: RpcDeferredReason; detail?: string; retryAt: Date } | null {
  const reason = rpcDeferredReason(error);
  if (!reason) return null;
  // A pg-boss shutdown/expiration AbortError must remain owned by pg-boss. The
  // durable job deadline has its own explicit classification and is safe to
  // convert into a future delivery after executeDurably persisted the expiry.
  if (isExpectedAbort(error) && reason !== "job_timeout") return null;
  const baseDelayMs = Math.max(minimumDelayMs, RPC_EXECUTION_RETRY_DELAY_MS[reason]);
  const delayMs = jitter
    ? Math.max(1_000, Math.round(baseDelayMs * (0.85 + Math.random() * 0.3)))
    : baseDelayMs;
  return {
    reason,
    detail: rpcDeferredDetail(error),
    retryAt: new Date(Date.now() + delayMs),
  };
}
function logJobDeferred(queue: string, details: Record<string, unknown>): void {
  const reason = typeof details.reason === "string" ? details.reason : "unspecified";
  const summary = deferredJobLog(`${queue}:${reason}`);
  if (!summary) return;
  logger.warn("jobs deferred", {
    queue,
    deferredSinceLastLog: summary.completedSinceLastLog,
    windowMs: summary.windowMs,
    ...details,
  }, "queue");
}
async function settleClaimedJobs<T>(
  jobs: Job<T>[],
  concurrency: number,
  handler: (job: Job<T>) => Promise<void>,
  useGlobalExecutionSlot = true,
): Promise<JobResult[]> {
  return mapWithConcurrency(jobs, Math.max(1, Math.min(concurrency, jobs.length)), async (job) => {
    try {
      if (useGlobalExecutionSlot) await withIndexerExecutionSlot(() => handler(job));
      else await handler(job);
      return { id: job.id, status: "completed" as const };
    } catch (error) {
      return {
        id: job.id,
        status: "failed" as const,
        output: {
          error: redactRpcErrorText(error instanceof Error ? error.message : String(error)),
        },
      };
    }
  });
}
function one<T>(
  jobs: Job<T>[],
  handler: (job: Job<T>) => Promise<void>,
): Promise<JobResult[]> {
  return settleClaimedJobs(jobs, jobs.length, handler);
}
function controlOne<T>(
  jobs: Job<T>[],
  handler: (job: Job<T>) => Promise<void>,
): Promise<JobResult[]> {
  // Control-plane scans only reconcile durable state and enqueue data-plane
  // work. Do not let a saturated RPC/data queue starve these already-claimed
  // singleton jobs until their pg-boss expiry elapses.
  return settleClaimedJobs(jobs, jobs.length, handler, false);
}
function batched<T>(
  jobs: Job<T>[],
  concurrency: number,
  handler: (job: Job<T>) => Promise<void>,
): Promise<JobResult[]> {
  return settleClaimedJobs(
    jobs,
    batchedClaimLayout(concurrency).handlerConcurrency,
    handler,
  );
}
async function phaseGate(queue: string, jobId: string, phase: "IDENTITY" | "METADATA" | "TRUST" | "DERIVED"): Promise<boolean> {
  if (await isBootstrapPhaseOpen(phase)) return false;
  const logSummary = repetitiveEventSummary(`phase-gated:${queue}`);
  if (logSummary) {
    logger.info("indexer jobs phase-gated", { ...logSummary, queue, latestJobId: jobId, requiredPhase: phase }, "queue");
  }
  return true;
}
export async function registerIndexerWorkers(boss: PgBoss): Promise<void> {
  await registerDeadLetterWorker(boss);
  await boss.work<BootstrapAdvancePayload>(
    INDEXER_QUEUES.BOOTSTRAP_ADVANCE,
    { ...UNSORTED_CLAIM_OPTIONS, localConcurrency: 1, batchSize: 1, heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 1, notifyPollingIntervalSeconds: 30 },
    (jobs) => controlOne(jobs, async (job) => {
      const payload = bootstrapAdvancePayloadSchema.parse(job.data);
      if (isStaleSemanticGeneration(payload.semanticGeneration)) {
        await enqueueBootstrapAdvance({ reason: "semantic-generation-replacement" });
        return;
      }
      await executeDurably({
        queue: INDEXER_QUEUES.BOOTSTRAP_ADVANCE,
        job,
        businessKey: `bootstrap-advance:${job.id}`,
        payloadGeneration: payload.v,
        operation: async (_signal, checkpoint) => {
          await checkpoint({ phase: "bootstrap-advance", reason: payload.reason });
          await runBootstrapAdvance(boss, payload.reason);
        },
      });
    }),
  );
  await boss.work<DerivedFinalizePayload>(
    INDEXER_QUEUES.DERIVED_FINALIZE,
    { ...UNSORTED_CLAIM_OPTIONS, localConcurrency: 1, batchSize: 1, heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 1 },
    (jobs) => one(jobs, async (job) => {
      const payload = derivedFinalizePayloadSchema.parse(job.data);
      if (isStaleSemanticGeneration(payload.semanticGeneration)) {
        await enqueueBootstrapAdvance({ reason: "derived-semantic-generation-replacement" });
        return;
      }
      const result = await executeDurably({
        queue: INDEXER_QUEUES.DERIVED_FINALIZE,
        job,
        businessKey: `derived-finalize:${payload.epochId}:${payload.topologyHash}:${job.id}`,
        payloadGeneration: payload.v,
        operation: async (signal, checkpoint) => {
          await checkpoint({ phase: "derived-finalize", epochId: payload.epochId });
          return runDerivedFinalizeJob(boss, payload, signal);
        },
      });
      logger.info("derived finalizer completed", {
        queue: INDEXER_QUEUES.DERIVED_FINALIZE,
        jobId: job.id,
        epochId: payload.epochId,
        result,
      }, "queue");
    }),
  );
  const agentSyncPollingIntervalSeconds = Math.max(
    0.5,
    config.loopIntervalMs / 1_000,
  );
  const agentSyncNotifyPollingIntervalSeconds = Math.max(
    30,
    agentSyncPollingIntervalSeconds,
  );
  const chainIds = () => getSyncableChainIds().filter((chainId) => chainId !== SOLANA_CHAIN_ID);
  const spreadJobs = async (kind: "catchup" | "validation" | "feedback") => {
    const ids = chainIds();
    if (kind === "feedback") return enqueueFeedbackSyncBatch(ids);
    const inserted = await mapWithConcurrency(ids, 4, async (chainId) => {
      if (kind === "catchup") return enqueueChainCatchup({ chainId, maxBlocks: config.evmIdentityRangeBlocks });
      return enqueueValidationSync({ chainId, maxBlocks: config.catchupMaxBlocks });
    });
    return inserted.filter((jobId): jobId is string => jobId != null).length;
  };
  for (const [queue, kind] of [
    [INDEXER_QUEUES.CATCHUP_SCAN, "catchup"],
    [INDEXER_QUEUES.VALIDATION_SCAN, "validation"],
    [INDEXER_QUEUES.FEEDBACK_SCAN, "feedback"],
  ] as const) {
    await boss.work<IndexerScanPayload>(
      queue,
      { ...UNSORTED_CLAIM_OPTIONS, localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 2, heartbeatRefreshSeconds: 30 },
      (jobs) => controlOne(jobs, async (job) => {
        const payload = indexerScanPayloadSchema.parse(job.data);
        if (await replaceStaleSemanticJob(queue, payload as unknown as Record<string, unknown>)) return;
        const requiredPhase = kind === "catchup" ? "IDENTITY" : "TRUST";
        if (await phaseGate(queue, job.id, requiredPhase)) return;
        const domain = kind === "catchup" ? "identity" : kind === "feedback" ? "reputation" : "validation";
        const generation = payload.generation ?? await registerScheduledScanIntent(domain);
        const enqueued = await executeDurably({
          queue,
          job,
          businessKey: `${queue}:${generation}`,
          payloadGeneration: payload.v,
          operation: async (_signal, checkpoint) => {
            await checkpoint({ phase: "spreading", kind });
            return spreadJobs(kind);
          },
        });
        const requeued = await acknowledgeScanWakeup({ domain, processedGeneration: generation });
        logger.info("indexer scan completed", { queue, jobId: job.id, enqueued, requeued }, "queue");
      }),
    );
  }
  await boss.work<RegistrationRefreshScanPayload>(
    INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN,
    { ...UNSORTED_CLAIM_OPTIONS, localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 2, heartbeatRefreshSeconds: 30 },
    (jobs) => controlOne(jobs, async (job) => {
      const payload = registrationRefreshScanPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN, job.id, "METADATA")) return;
      try {
        const result = await executeDurably({
          queue: INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN,
          job,
          businessKey: `registration-refresh:${job.id}`,
          payloadGeneration: payload.v,
          operation: async (_signal, checkpoint) => {
            await checkpoint({ phase: "registration-refresh-scan" });
            return runRegistrationRefreshScan();
          },
        });
        if (!result.complete) await enqueueRegistrationRefreshScan();
        await recordSyncOutcome({
          key: "registration-refresh",
          coalesceRoutineSuccess: true,
          outcome: {
            status: result.enqueued > 0 ? "updated" : "unchanged",
            observed: true,
            mutated: result.enqueued > 0,
            cursorAdvanced: true,
            complete: result.complete,
            coverage: result,
          },
        });
        await recordBootstrapSourceProgress({
          phase: "METADATA", sourceKey: REGISTRATION_METADATA_SOURCE_KEY, complete: result.complete,
          discoveredCount: result.enqueued, completedCount: result.enqueued,
        });
      } catch (error) {
        await recordSyncOutcome({ key: "registration-refresh", outcome: { status: "failed", reason: "registration_refresh_failed" }, error }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordBootstrapSourceProgress({ phase: "METADATA", sourceKey: REGISTRATION_METADATA_SOURCE_KEY, failedError: error });
        logFailure(INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN, job.id, undefined, error);
        throw error;
      }
    }),
  );
  await boss.work<AgentMetadataPayload>(
    INDEXER_QUEUES.AGENT_METADATA,
    { ...batchedClaimOptions(indexerRelationWriteConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2 },
    (jobs) => batched(jobs, indexerRelationWriteConcurrency, async (job) => {
      const payload = agentMetadataPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.AGENT_METADATA, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.AGENT_METADATA, job.id, "METADATA")) return;
      try {
        const result = await executeDurably({
          queue: INDEXER_QUEUES.AGENT_METADATA,
          job,
          // Registration documents are mutable. Keep retries of this pg-boss
          // delivery idempotent without memoizing the same URI across later
          // scheduled refresh deliveries.
          businessKey: `agent-metadata:${payload.chainId}:${payload.agentId}:${opaqueBusinessComponent(payload.uri)}:${job.id}`,
          payloadGeneration: payload.v,
          operation: async (signal, checkpoint) => {
            await checkpoint({ phase: "metadata-hydration", chainId: payload.chainId, agentId: payload.agentId });
            return runAgentMetadataJob(payload, signal);
          },
        });
        await recordSyncOutcome({
          key: `agent-metadata:${payload.chainId}`,
          chainId: payload.chainId,
          coalesceRoutineSuccess: true,
          outcome: {
            status: result.status === "deferred" ? "deferred" : result.status === "updated" ? "updated" : result.status === "permanent_invalid" ? "partial" : "unchanged",
            reason: result.status === "deferred" ? "metadata_unavailable" : result.status === "permanent_invalid" ? "invalid_registration" : undefined,
            observed: result.status !== "permanent_invalid" && result.status !== "deferred",
            mutated: result.status === "updated",
          },
        });
        if (result.status === "deferred") {
          logMetadataDeferred({ queue: INDEXER_QUEUES.AGENT_METADATA, jobId: job.id, chainId: payload.chainId });
        }
      } catch (error) {
        await recordSyncOutcome({
          key: `agent-metadata:${payload.chainId}`,
          chainId: payload.chainId,
          outcome: { status: "failed", reason: "metadata_hydration_failed" },
          error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        logFailure(INDEXER_QUEUES.AGENT_METADATA, job.id, payload.chainId, error);
        throw error;
      }
    }),
  );
  await boss.work<AgentSyncPayload>(
    INDEXER_QUEUES.AGENT_SYNC,
    {
      ...batchedClaimOptions(indexerWriteHeavyConcurrency),
      heartbeatRefreshSeconds: 30,
      pollingIntervalSeconds: agentSyncPollingIntervalSeconds,
      notifyPollingIntervalSeconds: agentSyncNotifyPollingIntervalSeconds,
      burstWhenReadyExceeds: 50,
      groupConcurrency: 1,
    },
    (jobs) => batched(jobs, indexerWriteHeavyConcurrency, async (job) => {
      const payload = agentSyncPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.AGENT_SYNC, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.AGENT_SYNC, job.id, "IDENTITY")) return;
      const effectiveExecutionKey = payload.executionKey ?? job.id;
      try {
        const sourceKey = payload.sourceSnapshot?.transactionHash == null
          ? effectiveExecutionKey
          : `${payload.sourceSnapshot.blockHash ?? "unhashed"}:${payload.sourceSnapshot.transactionHash}:${payload.sourceSnapshot.logIndex ?? "none"}`;
        const businessKey = `agent:${payload.chainId}:${payload.agentId}:${sourceKey}`;
        const outcome = await executeDurably({
          queue: INDEXER_QUEUES.AGENT_SYNC,
          job,
          businessKey,
          payloadGeneration: payload.v,
          sourceSnapshot: payload.sourceSnapshot,
          operation: async (signal, checkpoint) => {
            await checkpoint({ phase: "materializing", chainId: payload.chainId, agentId: payload.agentId });
            return runAgentSyncJob(payload.chainId, payload, signal, businessKey);
          },
        });
        await recordSyncOutcome({
          key: `agents:chain:${payload.chainId}`,
          chainId: payload.chainId,
          outcome,
          coalesceRoutineSuccess: true,
        });
        logJobCompleted(INDEXER_QUEUES.AGENT_SYNC, { jobId: job.id, chainId: payload.chainId, agentId: payload.agentId });
      } catch (error) {
        const deferred = rpcExecutionDeferral(error);
        if (deferred) {
          const retryPayload: AgentSyncPayload = payload.sourceSnapshot?.transactionHash == null
            ? { ...payload, executionKey: effectiveExecutionKey }
            : payload;
          const retryJobId = await enqueueAgentSyncExecutionRetry(retryPayload, deferred.retryAt);
          await recordSyncOutcome({
            key: `agents:chain:${payload.chainId}`,
            chainId: payload.chainId,
            outcome: {
              status: "deferred",
              reason: deferred.reason,
              observed: false,
              coverage: {
                agentId: payload.agentId,
                retryAt: deferred.retryAt.toISOString(),
                retryEnqueued: retryJobId != null,
                detail: deferred.detail ?? null,
              },
            },
          });
          logJobDeferred(INDEXER_QUEUES.AGENT_SYNC, {
            latestJobId: job.id,
            chainId: payload.chainId,
            agentId: payload.agentId,
            reason: deferred.reason,
            detail: deferred.detail,
            retryAt: deferred.retryAt.toISOString(),
            retryEnqueued: retryJobId != null,
          });
          return;
        }
        await recordSyncOutcome({
          key: `agents:chain:${payload.chainId}`, chainId: payload.chainId,
          outcome: { status: "failed", reason: "agent_sync_failed", observed: false }, error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        logFailure(INDEXER_QUEUES.AGENT_SYNC, job.id, payload.chainId, error);
        throw error;
      }
    }),
  );
  await boss.work<ScoreRecalculatePayload>(
    INDEXER_QUEUES.SCORE_RECALCULATE,
    { ...batchedClaimOptions(indexerWorkerClaimConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 1 },
    (jobs) => batched(jobs, indexerWorkerClaimConcurrency, async (job) => {
      const payload = scoreRecalculatePayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.SCORE_RECALCULATE, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.SCORE_RECALCULATE, job.id, "DERIVED")) return;
      const result = await executeDurably({
        queue: INDEXER_QUEUES.SCORE_RECALCULATE, job,
        businessKey: `score:${payload.agentId}:${payload.requestedVersion ?? "current"}`, payloadGeneration: payload.v,
        operation: async (signal, checkpoint) => {
          await checkpoint({ phase: "score-recalculate", agentId: payload.agentId });
          return runScoreRecalculateJob(payload, signal);
        },
      });
      await recordSyncOutcome({
        key: "score-recalculation",
        coalesceRoutineSuccess: true,
        outcome: { status: result === "updated" ? "updated" : result === "raced" ? "deferred" : result === "missing" ? "skipped" : "unchanged", observed: result !== "missing", mutated: result === "updated" },
      });
    }),
  );
  await boss.work<ScoreRepairScanPayload>(
    INDEXER_QUEUES.SCORE_REPAIR_SCAN,
    { ...UNSORTED_CLAIM_OPTIONS, localConcurrency: 1, batchSize: 1, heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2 },
    (jobs) => controlOne(jobs, async (job) => {
      const payload = scoreRepairScanPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.SCORE_REPAIR_SCAN, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.SCORE_REPAIR_SCAN, job.id, "DERIVED")) return;
      const result = await executeDurably({
        queue: INDEXER_QUEUES.SCORE_REPAIR_SCAN, job,
        businessKey: `score-repair:${payload.afterAgentId ?? 0}:${job.id}`, payloadGeneration: payload.v,
        operation: async (signal, checkpoint) => {
          await checkpoint({ phase: "score-repair", afterAgentId: payload.afterAgentId ?? 0 });
          return runScoreRepairScan(payload, signal);
        },
      });
      await recordSyncOutcome({
        key: "score-repair",
        coalesceRoutineSuccess: true,
        outcome: { status: result.enqueued ? "updated" : "unchanged", observed: true, mutated: result.enqueued > 0, complete: result.complete, coverage: result },
      });
      await recordBootstrapSourceProgress({
        phase: "DERIVED",
        sourceKey: DERIVED_SCORE_SOURCE_KEY,
        complete: false,
        discoveredCount: result.found,
      });
    }),
  );
  await boss.work<ClusterReconcilePayload>(
    INDEXER_QUEUES.CLUSTER_RECONCILE,
    { ...batchedClaimOptions(indexerRelationWriteConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2 },
    (jobs) => batched(jobs, indexerRelationWriteConcurrency, async (job) => {
      const payload = clusterReconcilePayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.CLUSTER_RECONCILE, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.CLUSTER_RECONCILE, job.id, "DERIVED")) return;
      try {
        const outcome = await executeDurably({
          queue: INDEXER_QUEUES.CLUSTER_RECONCILE, job,
          businessKey: `cluster:${payload.chainId}:${payload.agentId}:${payload.sourceObservationKey ?? "current"}`,
          payloadGeneration: payload.v, sourceSnapshot: { sourceObservationKey: payload.sourceObservationKey },
          operation: async (_signal, checkpoint) => {
            await checkpoint({ phase: "cluster-reconcile", chainId: payload.chainId, agentId: payload.agentId });
            return runClusterReconcileJob(payload);
          },
        });
        const deferred = outcome.deferredReason != null;
        await recordSyncOutcome({
          key: `cluster:chain:${payload.chainId}`, chainId: payload.chainId,
          coalesceRoutineSuccess: true,
          outcome: {
            status: deferred ? "deferred" : outcome.updated ? "updated" : "unchanged",
            reason: outcome.deferredReason,
            observed: !deferred,
            mutated: outcome.updated,
            coverage: { deferredReason: outcome.deferredReason ?? null, deferredDetail: outcome.deferredDetail ?? null },
          },
        });
        if (deferred) {
          logJobDeferred(INDEXER_QUEUES.CLUSTER_RECONCILE, { latestJobId: job.id, chainId: payload.chainId, reason: outcome.deferredReason, detail: outcome.deferredDetail });
        } else {
          logJobCompleted(INDEXER_QUEUES.CLUSTER_RECONCILE, { jobId: job.id, chainId: payload.chainId, agentId: payload.agentId, updated: outcome.updated });
        }
      } catch (error) {
        await recordSyncOutcome({
          key: `cluster:chain:${payload.chainId}`, chainId: payload.chainId,
          outcome: { status: "failed", reason: "cluster_reconcile_failed" }, error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        logFailure(INDEXER_QUEUES.CLUSTER_RECONCILE, job.id, payload.chainId, error);
        throw error;
      }
    }),
  );
  await boss.work<ChainCatchupPayload>(
    INDEXER_QUEUES.CHAIN_CATCHUP,
    { ...batchedClaimOptions(indexerWorkerClaimConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2 },
    (jobs) => batched(jobs, indexerWorkerClaimConcurrency, async (job) => {
      const payload = chainCatchupPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.CHAIN_CATCHUP, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.CHAIN_CATCHUP, job.id, "IDENTITY")) return;
      if (await replaceStaleEvmSourceJob(INDEXER_QUEUES.CHAIN_CATCHUP, payload, "identity")) return;
      try {
        const result = await executeDurably({
          queue: INDEXER_QUEUES.CHAIN_CATCHUP,
          job,
          businessKey: `catchup-plan:${payload.chainId}:${payload.registryGeneration}:${payload.requestedGeneration ?? "unbound"}:${job.id}`,
          payloadGeneration: payload.v,
          configurationGeneration: payload.configurationGeneration,
          operation: async (signal, checkpoint) => {
            await checkpoint({ phase: "planning-ranges", chainId: payload.chainId });
            return runCatchupJob(payload.chainId, payload, signal, checkpoint);
          },
        });
        const deferred = result.deferredReason != null;
        const queuedRanges = deferred ? 0 : await enqueueIdentityRangeLeases(result.rangeLeases);
        if (!deferred && !result.hasMore && payload.requestedGeneration) {
          await acknowledgeSourceScanWakeup({
            chainId: payload.chainId,
            domain: "identity",
            processedGeneration: payload.requestedGeneration,
          });
        }
        await recordSyncOutcome({
          key: `identity:chain:${payload.chainId}`,
          chainId: payload.chainId,
          coalesceRoutineSuccess: true,
          outcome: {
            status: deferred
              ? "deferred"
              : result.allocatedRanges > 0 || queuedRanges > 0 || result.enqueued > 0
                ? "updated"
                : result.hasMore
                  ? "unchanged"
                  : "skipped",
            reason: result.deferredReason ?? (!result.hasMore ? "cursor_current" : undefined),
            observed: !deferred,
            mutated: result.allocatedRanges > 0 || queuedRanges > 0 || result.enqueued > 0,
            cursorAdvanced: false,
            complete: !deferred && !result.hasMore,
            coverage: {
              enqueuedAgents: result.enqueued,
              allocatedRanges: result.allocatedRanges,
              queuedRanges,
              cursorBlock: result.cursorBlock,
              targetBlock: result.targetBlock,
              hasMore: result.hasMore,
              deferredReason: result.deferredReason ?? null,
              deferredDetail: result.deferredDetail ?? null,
            },
          },
        });
        await recordBootstrapSourceProgress({
          phase: "IDENTITY",
          sourceKey: currentEvmSourceDescriptor(payload.chainId, "identity").sourceKey,
          complete: !deferred && !result.hasMore,
          deferredReason: result.deferredReason,
          observedBlock: result.cursorBlock != null ? BigInt(result.cursorBlock) : null,
          discoveredCount: result.enqueued,
          completedCount: result.enqueued,
        });
        if (deferred) {
          logJobDeferred(INDEXER_QUEUES.CHAIN_CATCHUP, {
            latestJobId: job.id,
            chainId: payload.chainId,
            reason: result.deferredReason,
            detail: result.deferredDetail,
          });
        } else {
          logJobCompleted(INDEXER_QUEUES.CHAIN_CATCHUP, {
            jobId: job.id,
            chainId: payload.chainId,
            targetBlock: result.targetBlock,
            nextBlock: result.nextBlock,
            allocatedRanges: result.allocatedRanges,
            queuedRanges,
          });
        }
      } catch (error) {
        await recordSyncOutcome({
          key: `identity:chain:${payload.chainId}`,
          chainId: payload.chainId,
          outcome: { status: "failed", reason: "identity_range_planning_failed" },
          error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordBootstrapSourceProgress({
          phase: "IDENTITY",
          sourceKey: currentEvmSourceDescriptor(payload.chainId, "identity").sourceKey,
          failedError: error,
        });
        logFailure(INDEXER_QUEUES.CHAIN_CATCHUP, job.id, payload.chainId, error);
        throw error;
      }
    }),
  );
  await boss.work<IdentityRangePayload>(
    INDEXER_QUEUES.CHAIN_CATCHUP_RANGE,
    { ...batchedClaimOptions(indexerWorkerClaimConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 1, burstWhenReadyExceeds: 50 },
    (jobs) => batched(jobs, indexerWorkerClaimConcurrency, async (job) => {
      const payload = identityRangePayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.CHAIN_CATCHUP_RANGE, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.CHAIN_CATCHUP_RANGE, job.id, "IDENTITY")) return;
      if (await replaceStaleEvmSourceJob(INDEXER_QUEUES.CHAIN_CATCHUP_RANGE, payload, "identity")) return;
      try {
        const result = await executeDurably({
          queue: INDEXER_QUEUES.CHAIN_CATCHUP_RANGE,
          job,
          businessKey: `identity-range:${payload.leaseId}:${payload.revision}`,
          payloadGeneration: payload.v,
          configurationGeneration: payload.configurationGeneration,
          operation: async (signal, checkpoint) => {
            await checkpoint({
              phase: "scanning-range",
              chainId: payload.chainId,
              leaseId: payload.leaseId,
              fromBlock: payload.fromBlock,
              toBlock: payload.toBlock,
            });
            return runIdentityRangeJob(payload, job.id, signal, checkpoint);
          },
        });
        const deferred = result.deferredReason != null;
        if (!deferred && result.complete && payload.requestedGeneration) {
          await acknowledgeSourceScanWakeup({
            chainId: payload.chainId,
            domain: "identity",
            processedGeneration: payload.requestedGeneration,
          });
        }
        if (!result.complete) {
          const startAfter = deferred ? 15 : 1;
          await enqueueCoalescedWakeup(
            `chain-catchup:${payload.chainId}:${payload.requestedGeneration ?? "none"}:${startAfter}`,
            () => enqueueChainCatchupWakeup({
              chainId: payload.chainId,
              requestedGeneration: payload.requestedGeneration,
              maxBlocks: config.evmIdentityRangeBlocks,
            }, { startAfter }),
          );
        }
        await recordSyncOutcome({
          key: `identity:chain:${payload.chainId}`,
          chainId: payload.chainId,
          coalesceRoutineSuccess: true,
          outcome: {
            status: deferred
              ? "deferred"
              : result.skipped
                ? "skipped"
                : result.enqueued > 0 || result.decoded > 0
                  ? "updated"
                  : "unchanged",
            reason: result.deferredReason ?? (result.skipped ? "range_already_claimed_or_terminal" : undefined),
            observed: !deferred && !result.skipped,
            mutated: result.enqueued > 0 || result.decoded > 0,
            cursorAdvanced: result.advancedTo != null,
            complete: !deferred && result.complete,
            coverage: {
              leaseId: result.leaseId,
              fromBlock: payload.fromBlock,
              toBlock: payload.toBlock,
              advancedTo: result.advancedTo?.toString(10) ?? null,
              targetBlock: result.targetBlock.toString(10),
              enqueued: result.enqueued,
              decoded: result.decoded,
              rejected: result.rejected,
              deferredReason: result.deferredReason ?? null,
              deferredDetail: result.deferredDetail ?? null,
            },
          },
        });
        await recordBootstrapSourceProgress({
          phase: "IDENTITY",
          sourceKey: payload.sourceKey,
          complete: !deferred && result.complete,
          deferredReason: result.deferredReason,
          observedBlock: result.advancedTo,
          discoveredCount: result.enqueued,
          completedCount: result.enqueued,
          rejectedCount: result.rejected,
        });
        if (deferred) {
          logJobDeferred(INDEXER_QUEUES.CHAIN_CATCHUP_RANGE, {
            latestJobId: job.id,
            chainId: payload.chainId,
            leaseId: payload.leaseId,
            reason: result.deferredReason,
            detail: result.deferredDetail,
          });
        } else {
          logJobCompleted(INDEXER_QUEUES.CHAIN_CATCHUP_RANGE, {
            jobId: job.id,
            chainId: payload.chainId,
            leaseId: payload.leaseId,
            advancedTo: result.advancedTo?.toString(10) ?? null,
            complete: result.complete,
          });
        }
      } catch (error) {
        await enqueueCoalescedWakeup(
          `chain-catchup:${payload.chainId}:${payload.requestedGeneration ?? "none"}:15`,
          () => enqueueChainCatchupWakeup({
            chainId: payload.chainId,
            requestedGeneration: payload.requestedGeneration,
            maxBlocks: config.evmIdentityRangeBlocks,
          }, { startAfter: 15 }),
        ).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordSyncOutcome({
          key: `identity:chain:${payload.chainId}`,
          chainId: payload.chainId,
          outcome: { status: "failed", reason: "identity_range_failed" },
          error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordBootstrapSourceProgress({
          phase: "IDENTITY",
          sourceKey: payload.sourceKey,
          failedError: error,
        });
        logFailure(INDEXER_QUEUES.CHAIN_CATCHUP_RANGE, job.id, payload.chainId, error);
        throw error;
      }
    }),
  );
  await boss.work<FeedbackSyncPayload>(
    INDEXER_QUEUES.FEEDBACK_SYNC,
    { ...batchedClaimOptions(indexerWorkerClaimConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2 },
    (jobs) => batched(jobs, indexerWorkerClaimConcurrency, async (job) => {
      const payload = feedbackSyncPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.FEEDBACK_SYNC, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.FEEDBACK_SYNC, job.id, "TRUST")) return;
      if (await replaceStaleEvmSourceJob(INDEXER_QUEUES.FEEDBACK_SYNC, payload, "reputation")) return;
      try {
        const result = await executeDurably({
          queue: INDEXER_QUEUES.FEEDBACK_SYNC,
          job,
          businessKey: `feedback:${payload.chainId}:${payload.registryGeneration}:${payload.requestedGeneration ?? job.id}`,
          payloadGeneration: payload.v,
          configurationGeneration: payload.configurationGeneration,
          operation: async (signal, checkpoint) => {
            await checkpoint({ phase: "scanning", chainId: payload.chainId });
            return runFeedbackSyncJob(payload.chainId, signal, checkpoint);
          },
        });
        const deferred = result.deferredReason != null;
        if (!deferred && result.hasMore) await requestSourceScanContinuation({ chainId: payload.chainId, domain: "reputation" });
        if (!deferred && payload.requestedGeneration) {
          await acknowledgeSourceScanWakeup({ chainId: payload.chainId, domain: "reputation", processedGeneration: payload.requestedGeneration });
        }
        await recordSyncOutcome({
          key: `feedback:${payload.chainId}`, chainId: payload.chainId,
          coalesceRoutineSuccess: true,
          outcome: {
            status: deferred ? "deferred" : result.errors > 0 ? "partial" : result.synced > 0 ? "updated" : result.scanned > 0 ? "unchanged" : "skipped",
            reason: result.deferredReason ?? (result.scanned > 0 ? (result.errors > 0 ? "malformed_logs_quarantined" : undefined) : "cursor_current"),
            observed: !deferred && result.scanned > 0,
            mutated: result.synced > 0,
            cursorAdvanced: !deferred && result.scanned > 0,
            complete: !deferred && !result.hasMore,
            coverage: { synced: result.synced, errors: result.errors, scanned: result.scanned, hasMore: result.hasMore, deferredReason: result.deferredReason ?? null, deferredDetail: result.deferredDetail ?? null },
          },
        });
        await recordBootstrapSourceProgress({
          phase: "TRUST",
          sourceKey: currentEvmSourceDescriptor(payload.chainId, "reputation").sourceKey,
          complete: !deferred && !result.hasMore,
          deferredReason: result.deferredReason,
          discoveredCount: result.scanned,
          completedCount: result.synced,
          rejectedCount: result.errors,
        });
        if (deferred) {
          logJobDeferred(INDEXER_QUEUES.FEEDBACK_SYNC, { latestJobId: job.id, chainId: payload.chainId, reason: result.deferredReason, detail: result.deferredDetail });
        } else {
          logJobCompleted(INDEXER_QUEUES.FEEDBACK_SYNC, { jobId: job.id, chainId: payload.chainId });
        }
      } catch (error) {
        await recordSyncOutcome({
          key: `feedback:${payload.chainId}`, chainId: payload.chainId,
          outcome: { status: "failed", reason: "feedback_scan_failed" }, error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordBootstrapSourceProgress({ phase: "TRUST", sourceKey: currentEvmSourceDescriptor(payload.chainId, "reputation").sourceKey, failedError: error });
        logFailure(INDEXER_QUEUES.FEEDBACK_SYNC, job.id, payload.chainId, error);
        throw error;
      }
    }),
  );
  await boss.work<ValidationSyncPayload>(
    INDEXER_QUEUES.VALIDATION_SYNC,
    { ...batchedClaimOptions(indexerWorkerClaimConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2 },
    (jobs) => batched(jobs, indexerWorkerClaimConcurrency, async (job) => {
      const payload = validationSyncPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.VALIDATION_SYNC, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.VALIDATION_SYNC, job.id, "TRUST")) return;
      if (await replaceStaleEvmSourceJob(INDEXER_QUEUES.VALIDATION_SYNC, payload, "validation")) return;
      try {
        const cursorKey = payload.continuationFromBlock ?? "cursor";
        const result = await executeDurably({
          queue: INDEXER_QUEUES.VALIDATION_SYNC,
          job,
          businessKey: `validation:${payload.chainId}:${payload.registryGeneration}:${payload.requestedGeneration ?? job.id}:${cursorKey}`,
          payloadGeneration: payload.v,
          configurationGeneration: payload.configurationGeneration,
          operation: async (signal, checkpoint) => {
            await checkpoint({ phase: "scanning", chainId: payload.chainId, continuationFromBlock: payload.continuationFromBlock });
            return runValidationSyncJob(payload.chainId, payload, signal, checkpoint);
          },
        });
        const deferred = result.deferredReason != null;
        if (!deferred && result.hasMore && result.nextBlock) await requestSourceScanContinuation({ chainId: payload.chainId, domain: "validation" });
        if (!deferred && payload.requestedGeneration) {
          await acknowledgeSourceScanWakeup({
            chainId: payload.chainId,
            domain: "validation",
            processedGeneration: payload.requestedGeneration,
            continuationFromBlock: result.hasMore ? result.nextBlock ?? undefined : undefined,
          });
        }
        await recordSyncOutcome({
          key: `validation:${payload.chainId}`, chainId: payload.chainId,
          coalesceRoutineSuccess: true,
          outcome: {
            status: deferred ? "deferred" : result.scanned > 0 ? (result.upserted > 0 ? "updated" : "unchanged") : "skipped",
            reason: result.deferredReason ?? (result.scanned > 0 ? undefined : "cursor_current"),
            observed: !deferred && result.scanned > 0,
            mutated: result.upserted > 0,
            cursorAdvanced: !deferred && result.scanned > 0,
            complete: !deferred && !result.hasMore,
            coverage: { upserted: result.upserted, scanned: result.scanned, hasMore: result.hasMore, deferredReason: result.deferredReason ?? null, deferredDetail: result.deferredDetail ?? null },
          },
        });
        await recordBootstrapSourceProgress({
          phase: "TRUST",
          sourceKey: currentEvmSourceDescriptor(payload.chainId, "validation").sourceKey,
          complete: !deferred && !result.hasMore,
          deferredReason: result.deferredReason,
          discoveredCount: result.scanned,
          completedCount: result.upserted,
        });
        if (deferred) {
          logJobDeferred(INDEXER_QUEUES.VALIDATION_SYNC, { latestJobId: job.id, chainId: payload.chainId, reason: result.deferredReason, detail: result.deferredDetail });
        } else {
          logJobCompleted(INDEXER_QUEUES.VALIDATION_SYNC, { jobId: job.id, chainId: payload.chainId, nextBlock: result.nextBlock });
        }
      } catch (error) {
        await recordSyncOutcome({
          key: `validation:${payload.chainId}`, chainId: payload.chainId,
          outcome: { status: "failed", reason: "validation_scan_failed" }, error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordBootstrapSourceProgress({ phase: "TRUST", sourceKey: currentEvmSourceDescriptor(payload.chainId, "validation").sourceKey, failedError: error });
        logFailure(INDEXER_QUEUES.VALIDATION_SYNC, job.id, payload.chainId, error);
        throw error;
      }
    }),
  );
  await boss.work<SolanaMetadataPayload>(
    INDEXER_QUEUES.SOLANA_METADATA,
    { ...batchedClaimOptions(indexerRelationWriteConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2 },
    (jobs) => batched(jobs, indexerRelationWriteConcurrency, async (job) => {
      const payload = solanaMetadataPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.SOLANA_METADATA, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.SOLANA_METADATA, job.id, "METADATA")) return;
      try {
        const result = await executeDurably({
          queue: INDEXER_QUEUES.SOLANA_METADATA,
          job,
          // The same URI can legitimately change between refresh scans. Scope
          // durable replay to this delivery rather than the URI for all time.
          businessKey: `solana-metadata:${payload.asset}:${opaqueBusinessComponent(payload.uri)}:${job.id}`,
          payloadGeneration: payload.v,
          operation: async (signal, checkpoint) => {
            await checkpoint({ phase: "metadata-hydration", asset: payload.asset });
            return runSolanaMetadataJob(payload, signal);
          },
        });
        await recordSyncOutcome({
          key: "solana-metadata",
          chainId: SOLANA_CHAIN_ID,
          coalesceRoutineSuccess: true,
          outcome: {
            status: result.status === "deferred" ? "deferred" : result.status === "updated" ? "updated" : result.status === "permanent_invalid" ? "partial" : "unchanged",
            reason: result.status === "deferred" ? "metadata_unavailable" : result.status === "permanent_invalid" ? "invalid_registration" : undefined,
            observed: result.status !== "permanent_invalid" && result.status !== "deferred",
            mutated: result.status === "updated",
          },
        });
        if (result.status === "deferred") {
          logMetadataDeferred({ queue: INDEXER_QUEUES.SOLANA_METADATA, jobId: job.id, chainId: SOLANA_CHAIN_ID });
        }
      } catch (error) {
        await recordSyncOutcome({
          key: "solana-metadata",
          chainId: SOLANA_CHAIN_ID,
          outcome: { status: "failed", reason: "metadata_hydration_failed" },
          error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        logFailure(INDEXER_QUEUES.SOLANA_METADATA, job.id, SOLANA_CHAIN_ID, error);
        throw error;
      }
    }),
  );
  await boss.work<Solana8004TrustScanPayload>(
    INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN,
    { ...UNSORTED_CLAIM_OPTIONS, localConcurrency: 1, batchSize: 1, heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2, notifyPollingIntervalSeconds: 30 },
    (jobs) => one(jobs, async (job) => {
      const payload = solana8004TrustScanPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, job.id, "TRUST")) return;
      try {
        const requestedGeneration = payload.requestedGeneration ?? await registerScheduledScanIntent("solana-8004-trust");
        const result = await executeDurably({
          queue: INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN,
          job,
          businessKey: `solana-8004-trust-scan:${payload.executionKey ?? `legacy-job:${job.id}`}`,
          payloadGeneration: payload.v,
          operation: async (signal, checkpoint) => runSolana8004TrustScanJob({ ...payload, requestedGeneration }, signal, checkpoint),
        });
        const requeued = result.bootstrapComplete
          ? await acknowledgeSolana8004TrustScanWakeup(requestedGeneration)
          : false;
        await recordSyncOutcome({
          key: "solana-8004:trust-scan",
          chainId: SOLANA_CHAIN_ID,
          coalesceRoutineSuccess: true,
          outcome: {
            status: result.enqueuedCount > 0 ? "updated" : "unchanged",
            observed: true,
            mutated: result.enqueuedCount > 0,
            cursorAdvanced: result.pageCount > 0 || result.passComplete,
            complete: result.bootstrapComplete,
            coverage: {
              mode: result.mode,
              pageCount: result.pageCount,
              enqueuedCount: result.enqueuedCount,
              targetSlot: result.targetSlot,
              cursorToken: result.cursorToken,
            },
          },
        });
        logJobCompleted(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, {
          jobId: job.id, chainId: SOLANA_CHAIN_ID, ...result, requeued,
        });
      } catch (error) {
        if (error instanceof BusinessExecutionInProgressError) {
          const retryAt = businessExecutionRetryAt(error);
          const retryJobId = await enqueueSolana8004TrustScanExecutionRetry(
            payload,
            job.id,
            retryAt,
          );
          await recordSyncOutcome({
            key: "solana-8004:trust-scan",
            chainId: SOLANA_CHAIN_ID,
            outcome: {
              status: "deferred",
              reason: "business_execution_in_progress",
              observed: false,
              coverage: {
                retryAt: retryAt.toISOString(),
                retryEnqueued: retryJobId != null,
              },
            },
          });
          logJobDeferred(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, {
            latestJobId: job.id,
            chainId: SOLANA_CHAIN_ID,
            reason: "business_execution_in_progress",
            retryAt: retryAt.toISOString(),
            retryEnqueued: retryJobId != null,
          });
          return;
        }
        const deferred = rpcExecutionDeferral(error);
        if (deferred) {
          const retryJobId = await enqueueSolana8004TrustScanExecutionRetry(
            payload,
            job.id,
            deferred.retryAt,
          );
          await recordSyncOutcome({
            key: "solana-8004:trust-scan",
            chainId: SOLANA_CHAIN_ID,
            outcome: {
              status: "deferred",
              reason: deferred.reason,
              observed: false,
              coverage: {
                retryAt: deferred.retryAt.toISOString(),
                retryEnqueued: retryJobId != null,
                detail: deferred.detail ?? null,
              },
            },
          });
          await recordBootstrapSourceProgress({
            phase: "TRUST",
            sourceKey: SOLANA_8004_TRUST_SOURCE_KEY,
            deferredReason: deferred.reason,
          });
          logJobDeferred(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, {
            latestJobId: job.id,
            chainId: SOLANA_CHAIN_ID,
            reason: deferred.reason,
            detail: deferred.detail,
            retryAt: deferred.retryAt.toISOString(),
            retryEnqueued: retryJobId != null,
          });
          return;
        }
        await recordSyncOutcome({
          key: "solana-8004:trust-scan", chainId: SOLANA_CHAIN_ID,
          outcome: { status: "failed", reason: "solana_8004_trust_scan_failed" }, error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordBootstrapSourceProgress({ phase: "TRUST", sourceKey: SOLANA_8004_TRUST_SOURCE_KEY, failedError: error });
        logFailure(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, job.id, SOLANA_CHAIN_ID, error);
        throw error;
      }
    }),
  );
  await boss.work<Solana8004TrustSyncPayload>(
    INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC,
    { ...batchedClaimOptions(indexerWorkerClaimConcurrency), heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 1, notifyPollingIntervalSeconds: 30 },
    (jobs) => batched(jobs, indexerWorkerClaimConcurrency, async (job) => {
      const payload = solana8004TrustSyncPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, job.id, "TRUST")) {
        // Phase-gating completes the pg-boss delivery. Return the durable
        // reservation to PENDING so a later TRUST phase can materialize it again.
        await prisma.solana8004TrustSignature.updateMany({
          where: { signature: payload.signature, status: "QUEUED" },
          data: { status: "PENDING" },
        });
        return;
      }
      try {
        const result = await executeDurably({
          queue: INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC,
          job,
          businessKey: `solana-8004-trust-sync:${payload.signature}`,
          payloadGeneration: payload.v,
          operation: async (signal, checkpoint) => runSolana8004TrustSyncJob(payload, signal, checkpoint),
        });
        await recordSyncOutcome({
          key: "solana-8004:trust",
          chainId: SOLANA_CHAIN_ID,
          coalesceRoutineSuccess: true,
          outcome: {
            status: result.observations > 0 ? "updated" : result.status === "pruned" ? "partial" : "unchanged",
            reason: result.status === "pruned"
              ? "history_pruned"
              : result.status === "skipped"
                ? "stale_queue_job"
                : undefined,
            observed: result.status !== "pruned" && result.status !== "skipped",
            mutated: result.observations > 0,
            coverage: { signature: payload.signature, slot: payload.slot, observations: result.observations, affectedAgentIds: result.affectedAgentIds },
          },
        });
        await enqueueCoalescedWakeup(
          "bootstrap:solana-8004-trust-sync:1",
          () => enqueueBootstrapAdvance({ reason: "solana-8004-trust-sync-complete", startAfter: 1 }),
        );
        logJobCompleted(INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, {
          jobId: job.id, chainId: SOLANA_CHAIN_ID, signature: payload.signature, slot: payload.slot, ...result,
        });
      } catch (error) {
        if (error instanceof BusinessExecutionInProgressError) {
          const retryAt = businessExecutionRetryAt(error);
          // The signature table is the durable retry queue. Do not create a
          // second pg-boss retry while another execution owns this signature.
          await recordSyncOutcome({
            key: "solana-8004:trust",
            chainId: SOLANA_CHAIN_ID,
            outcome: {
              status: "deferred",
              reason: "business_execution_in_progress",
              observed: false,
              coverage: {
                signature: payload.signature,
                slot: payload.slot,
                retryAt: retryAt.toISOString(),
              },
            },
          });
          logJobDeferred(INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, {
            latestJobId: job.id,
            chainId: SOLANA_CHAIN_ID,
            signature: payload.signature,
            reason: "business_execution_in_progress",
            retryAt: retryAt.toISOString(),
          });
          return;
        }
        if (error instanceof Solana8004TrustRetryDeferredError) {
          await recordSyncOutcome({
            key: "solana-8004:trust",
            chainId: SOLANA_CHAIN_ID,
            outcome: {
              status: "deferred",
              reason: "trust_retry_cooldown",
              observed: false,
              coverage: {
                signature: payload.signature,
                slot: payload.slot,
                retryAt: error.retryAt.toISOString(),
              },
            },
          });
          logJobDeferred(INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, {
            latestJobId: job.id,
            chainId: SOLANA_CHAIN_ID,
            signature: payload.signature,
            reason: "trust_retry_cooldown",
            retryAt: error.retryAt.toISOString(),
          });
          return;
        }
        const deferred = rpcExecutionDeferral(
          error,
          SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS,
          false,
        );
        if (deferred) {
          // syncSolana8004TrustTransaction persisted FAILED before rethrowing.
          // Leave the retry in that durable table; the bounded scanner will
          // rematerialize it after cooldown instead of growing a deferred queue.
          await recordSyncOutcome({
            key: "solana-8004:trust",
            chainId: SOLANA_CHAIN_ID,
            outcome: {
              status: "deferred",
              reason: deferred.reason,
              observed: false,
              coverage: {
                signature: payload.signature,
                slot: payload.slot,
                retryAt: deferred.retryAt.toISOString(),
                detail: deferred.detail ?? null,
              },
            },
          });
          logJobDeferred(INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, {
            latestJobId: job.id,
            chainId: SOLANA_CHAIN_ID,
            signature: payload.signature,
            reason: deferred.reason,
            detail: deferred.detail,
            retryAt: deferred.retryAt.toISOString(),
          });
          return;
        }
        await recordSyncOutcome({
          key: "solana-8004:trust", chainId: SOLANA_CHAIN_ID,
          outcome: { status: "failed", reason: "solana_8004_trust_sync_failed" }, error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        logFailure(INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, job.id, SOLANA_CHAIN_ID, error);
        throw error;
      }
    }),
  );
  await boss.work<Solana8004SnapshotPayload>(
    INDEXER_QUEUES.SOLANA_8004_SNAPSHOT,
    { ...UNSORTED_CLAIM_OPTIONS, localConcurrency: 1, batchSize: 1, heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2, notifyPollingIntervalSeconds: 30 },
    (jobs) => one(jobs, async (job) => {
      const payload = solana8004SnapshotPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.SOLANA_8004_SNAPSHOT, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.SOLANA_8004_SNAPSHOT, job.id, "IDENTITY")) return;
      try {
        const requestedGeneration = payload.requestedGeneration ?? await registerScheduledScanIntent("solana-agents");
        const result = await executeDurably({
          queue: INDEXER_QUEUES.SOLANA_8004_SNAPSHOT,
          job,
          businessKey: `solana-8004:${requestedGeneration}`,
          payloadGeneration: payload.v,
          operation: async (signal, checkpoint) => runSolana8004SnapshotJob(payload, signal, checkpoint),
        });
        await acknowledgeSolanaScanWakeup(requestedGeneration);
        await recordSyncOutcome({
          key: `agents:chain:${SOLANA_CHAIN_ID}`,
          chainId: SOLANA_CHAIN_ID,
          outcome: {
            status: result.indexedCount > 0 ? "updated" : "unchanged",
            observed: true,
            mutated: result.indexedCount > 0,
            cursorAdvanced: true,
            complete: true,
            coverage: {
              generation: result.generation,
              sourceSlot: result.sourceSlot,
              inventoryCount: result.inventoryCount,
              indexedCount: result.indexedCount,
              terminalRejectCount: result.terminalRejectCount,
              inventoryDigest: result.inventoryDigest,
            },
          },
        });
        await recordBootstrapSourceProgress({
          phase: "IDENTITY",
          sourceKey: SOLANA_8004_IDENTITY_SOURCE_KEY,
          complete: true,
          discoveredCount: result.inventoryCount,
          completedCount: result.indexedCount,
          rejectedCount: result.terminalRejectCount,
          observedGeneration: BigInt(result.generation),
          observedSlot: BigInt(result.sourceSlot),
        });
        logJobCompleted(INDEXER_QUEUES.SOLANA_8004_SNAPSHOT, {
          jobId: job.id,
          chainId: SOLANA_CHAIN_ID,
          generation: result.generation,
          sourceSlot: result.sourceSlot,
          inventoryCount: result.inventoryCount,
          indexedCount: result.indexedCount,
          terminalRejectCount: result.terminalRejectCount,
          inventoryDigest: result.inventoryDigest,
        });
      } catch (error) {
        await recordSyncOutcome({
          key: `agents:chain:${SOLANA_CHAIN_ID}`,
          chainId: SOLANA_CHAIN_ID,
          outcome: { status: "failed", reason: "solana_8004_snapshot_failed" },
          error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordBootstrapSourceProgress({ phase: "IDENTITY", sourceKey: SOLANA_8004_IDENTITY_SOURCE_KEY, failedError: error });
        logFailure(INDEXER_QUEUES.SOLANA_8004_SNAPSHOT, job.id, SOLANA_CHAIN_ID, error);
        throw error;
      }
    }),
  );
  await boss.work<MetaplexSnapshotPayload>(
    INDEXER_QUEUES.METAPLEX_SNAPSHOT,
    { ...UNSORTED_CLAIM_OPTIONS, localConcurrency: 1, batchSize: 1, heartbeatRefreshSeconds: 30, pollingIntervalSeconds: 2, notifyPollingIntervalSeconds: 30 },
    (jobs) => one(jobs, async (job) => {
      const payload = metaplexSnapshotPayloadSchema.parse(job.data);
      if (await replaceStaleSemanticJob(INDEXER_QUEUES.METAPLEX_SNAPSHOT, payload as unknown as Record<string, unknown>)) return;
      if (await phaseGate(INDEXER_QUEUES.METAPLEX_SNAPSHOT, job.id, "IDENTITY")) return;
      try {
        const result = await executeDurably({
          queue: INDEXER_QUEUES.METAPLEX_SNAPSHOT,
          job,
          businessKey: `metaplex-snapshot:${job.id}`,
          payloadGeneration: payload.v,
          operation: async (signal, checkpoint) => {
            await checkpoint({ phase: "metaplex-current-state-snapshot" });
            return runMetaplexSnapshotJob(payload, signal);
          },
        });
        await recordSyncOutcome({
          key: "agents:solana:metaplex-current-state",
          chainId: SOLANA_CHAIN_ID,
          outcome: {
            status: result.ok ? (result.indexed > 0 ? "updated" : "unchanged") : "failed",
            reason: result.ok ? undefined : "metaplex_snapshot_failed",
            observed: true,
            mutated: result.indexed > 0,
            cursorAdvanced: result.ok,
            complete: result.ok,
            coverage: { attempted: result.attempted, indexed: result.indexed, existing: result.existing, failed: result.failed },
          },
        });
        await recordBootstrapSourceProgress({
          phase: "IDENTITY", sourceKey: METAPLEX_IDENTITY_SOURCE_KEY, complete: result.ok,
          discoveredCount: result.attempted, completedCount: result.indexed + result.existing, rejectedCount: result.failed,
          failedError: result.ok ? undefined : result.message ?? "Metaplex current-state snapshot failed",
        });
        if (!result.ok) {
          const failedDetails = result.results
            .filter((item) => !item.ok)
            .slice(0, 3)
            .map((item) => `${item.assetAddress}: ${item.error ?? "unknown identity failure"}`)
            .join("; ");
          const summary = result.message ?? "Metaplex current-state snapshot failed";
          throw new Error(failedDetails ? `${summary}: ${failedDetails}` : summary);
        }
        logJobCompleted(INDEXER_QUEUES.METAPLEX_SNAPSHOT, { jobId: job.id, attempted: result.attempted });
      } catch (error) {
        await recordSyncOutcome({
          key: "agents:solana:metaplex-current-state",
          chainId: SOLANA_CHAIN_ID,
          outcome: { status: "failed", reason: "metaplex_snapshot_failed" },
          error,
        }).catch((stateError) => {
          throw new AggregateError(
            [error, stateError],
            "Indexer job failed and its recovery state could not be persisted",
          );
        });
        await recordBootstrapSourceProgress({ phase: "IDENTITY", sourceKey: METAPLEX_IDENTITY_SOURCE_KEY, failedError: error });
        logFailure(INDEXER_QUEUES.METAPLEX_SNAPSHOT, job.id, SOLANA_CHAIN_ID, error);
        throw error;
      }
    }),
  );
}
