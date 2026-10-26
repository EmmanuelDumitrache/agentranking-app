import { randomUUID } from "node:crypto";
import { fromPrisma, type Db, type JobInsert, type PgBoss, type SendOptions } from "pg-boss";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getBoss } from "./boss.js";
import type {
  AgentSyncPayload,
  ChainCatchupPayload,
  FeedbackSyncPayload,
  SourceSnapshot,
  ValidationSyncPayload,
  ClusterReconcilePayload,
  SolanaMetadataPayload,
  AgentMetadataPayload,
  RegistrationRefreshScanPayload,
  ScoreRecalculatePayload,
  ScoreRepairScanPayload,
  MetaplexSnapshotPayload,
  BootstrapAdvancePayload,
  DerivedFinalizePayload,
  IdentityRangePayload,
  Solana8004TrustScanPayload,
  Solana8004TrustSyncPayload,
} from "./contracts.js";
import { INDEXER_PRIORITIES, INDEXER_QUEUES } from "./queues.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
import { acknowledgeScanIntentState, mergeScanIntentState } from "./scan-intent-state.js";
import { WORKER_SEMANTIC_GENERATION } from "./semantic-generation.js";
import { currentEvmSourceDescriptor } from "../lib/source-descriptor.js";
import { isBootstrapPhaseOpen } from "./bootstrap-state.js";
import { SOLANA_8004_IDENTITY_SOURCE_KEY, SOLANA_8004_TRUST_SOURCE_KEY } from "../sync/solana-current-state-types.js";
import type { IdentityRangeLeasePayloadData } from "../sync/identity-range-leases.js";
import { mapWithConcurrency } from "@/lib/async-pool";
import {
  SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS,
  SOLANA_8004_TRUST_STALE_QUEUE_RESERVATION_MS,
  SOLANA_8004_TRUST_STALE_RUNNING_MS,
  solana8004TrustQueueTargetDepth,
} from "../sync/solana-8004/trust-queue-policy.js";

const INDEXER_JOB_INSERT_BATCH_SIZE = 500;
const CLUSTER_ENQUEUE_COALESCE_MS = 10;

function uniqueBy<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const unique = new Map<string, T>();
  for (const value of values) unique.set(keyOf(value), value);
  return [...unique.values()];
}

async function insertJobsInBatches<T extends object>(
  boss: PgBoss,
  queue: string,
  jobs: readonly JobInsert<T>[],
  requestedBatchSize = INDEXER_JOB_INSERT_BATCH_SIZE,
  db?: Db,
): Promise<string[]> {
  if (jobs.length === 0) return [];
  const normalizedBatchSize = Number.isFinite(requestedBatchSize)
    ? Math.trunc(requestedBatchSize)
    : INDEXER_JOB_INSERT_BATCH_SIZE;
  const batchSize = Math.max(1, Math.min(INDEXER_JOB_INSERT_BATCH_SIZE, normalizedBatchSize));
  const insertedIds: string[] = [];
  for (let offset = 0; offset < jobs.length; offset += batchSize) {
    const ids = await boss.insert(queue, jobs.slice(offset, offset + batchSize), {
      returnId: true,
      ...(db ? { db } : {}),
    });
    if (ids) insertedIds.push(...ids);
  }
  return insertedIds;
}

async function insertJobCountInBatches<T extends object>(
  boss: PgBoss,
  queue: string,
  jobs: readonly JobInsert<T>[],
  requestedBatchSize = INDEXER_JOB_INSERT_BATCH_SIZE,
  db?: Db,
): Promise<number> {
  if (jobs.length === 0) return 0;
  const normalizedBatchSize = Number.isFinite(requestedBatchSize)
    ? Math.trunc(requestedBatchSize)
    : INDEXER_JOB_INSERT_BATCH_SIZE;
  const batchSize = Math.max(1, Math.min(INDEXER_JOB_INSERT_BATCH_SIZE, normalizedBatchSize));
  let insertedCount = 0;
  for (let offset = 0; offset < jobs.length; offset += batchSize) {
    const ids = await boss.insert(queue, jobs.slice(offset, offset + batchSize), {
      returnId: true,
      ...(db ? { db } : {}),
    });
    insertedCount += ids?.length ?? 0;
  }
  return insertedCount;
}

type AgentSyncEnqueuePayload = {
  chainId: number;
  agentId: string | number | bigint;
  source?: string;
  sourceSnapshot?: SourceSnapshot;
};

type AgentSyncRoutingPayload = Pick<AgentSyncPayload, "chainId" | "agentId" | "sourceSnapshot">;
const EXECUTION_RETRY_DEDUP_SECONDS = 24 * 60 * 60;

function agentSyncSingletonKey(payload: AgentSyncRoutingPayload): string {
  const agentId = String(payload.agentId);
  return payload.sourceSnapshot?.transactionHash
    ? `${payload.chainId}:${agentId}:${payload.sourceSnapshot.blockHash ?? "unhashed"}:${payload.sourceSnapshot.transactionHash}:${payload.sourceSnapshot.logIndex ?? "none"}`
    : `${payload.chainId}:${agentId}`;
}

function agentSyncGroupId(payload: Pick<AgentSyncRoutingPayload, "chainId" | "agentId">): string {
  return `${payload.chainId}:${String(payload.agentId)}`;
}

function executionRetrySlot(startAfter: Date): number {
  return Math.floor(startAfter.getTime() / 60_000);
}

function bootstrapAdvanceData(reason: string): BootstrapAdvancePayload {
  return {
    v: 1,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    reason,
  };
}
function bootstrapAdvanceSendOptions(startAfter?: number | Date): SendOptions {
  return {
    priority: INDEXER_PRIORITIES.BOOTSTRAP_ADVANCE,
    singletonKey: "coordinator",
    ...(startAfter !== undefined ? { startAfter } : {}),
  };
}
export async function enqueueBootstrapAdvance(options: {
  reason: string;
  startAfter?: number | Date;
}): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(
    INDEXER_QUEUES.BOOTSTRAP_ADVANCE,
    bootstrapAdvanceData(options.reason),
    bootstrapAdvanceSendOptions(options.startAfter),
  );
}
export async function enqueueBootstrapAdvanceInTx(
  tx: Prisma.TransactionClient,
  options: { reason: string; startAfter?: number | Date },
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(
    INDEXER_QUEUES.BOOTSTRAP_ADVANCE,
    bootstrapAdvanceData(options.reason),
    { ...bootstrapAdvanceSendOptions(options.startAfter), db: fromPrisma(tx) },
  );
}

export async function enqueueDerivedFinalize(
  payload: DerivedFinalizePayload,
  options: Partial<Pick<SendOptions, "startAfter">> = {},
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(INDEXER_QUEUES.DERIVED_FINALIZE, payload, {
    priority: INDEXER_PRIORITIES.DERIVED_FINALIZE,
    singletonKey: payload.epochId,
    ...options,
  });
}

async function requestScanIntent(input: {
  sourceKey: string;
  domain: string;
  chainId?: number;
  registryAddress?: string;
  requestedFinalizedTarget?: bigint;
  minimumRescanBoundary?: bigint;
  forceReconciliation?: boolean;
}): Promise<string> {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.indexerScanIntent.findUnique({ where: { sourceKey: input.sourceKey } });
    const next = mergeScanIntentState(current ? {
      desiredGeneration: current.desiredGeneration,
      acknowledgedGeneration: current.acknowledgedGeneration,
      requestedFinalizedTarget: current.requestedFinalizedTarget,
      minimumRescanBoundary: current.minimumRescanBoundary,
      forceReconciliation: current.forceReconciliation,
    } : null, input);
    if (!current) {
      await tx.indexerScanIntent.create({
        data: {
          sourceKey: input.sourceKey,
          domain: input.domain,
          chainId: input.chainId,
          registryAddress: input.registryAddress,
          ...next,
        },
      });
    } else {
      await tx.indexerScanIntent.update({
        where: { sourceKey: input.sourceKey },
        data: {
          domain: input.domain,
          chainId: input.chainId,
          registryAddress: input.registryAddress,
          ...next,
          requestedAt: new Date(),
        },
      });
    }
    return next.desiredGeneration.toString(10);
  }, { isolationLevel: "Serializable" }), 10);
}
export type SourceScanDomain = "identity" | "reputation" | "validation";
function sourceScanDescriptor(chainId: number, domain: SourceScanDomain): {
  sourceKey: string;
  queue: string;
  priority: number;
  registryAddress: string;
  registryGeneration: string;
  configurationGeneration: string;
} {
  const source = currentEvmSourceDescriptor(chainId, domain);
  if (domain === "identity") return { ...source, queue: INDEXER_QUEUES.CHAIN_CATCHUP, priority: INDEXER_PRIORITIES.CHAIN_CATCHUP };
  if (domain === "reputation") return { ...source, queue: INDEXER_QUEUES.FEEDBACK_SYNC, priority: INDEXER_PRIORITIES.FEEDBACK_SYNC };
  return { ...source, queue: INDEXER_QUEUES.VALIDATION_SYNC, priority: INDEXER_PRIORITIES.VALIDATION_SYNC };
}
export async function requestSourceScanContinuation(input: { chainId: number; domain: SourceScanDomain }): Promise<string> {
  const descriptor = sourceScanDescriptor(input.chainId, input.domain);
  return requestScanIntent({ sourceKey: descriptor.sourceKey, domain: input.domain, chainId: input.chainId, registryAddress: descriptor.registryAddress });
}
export async function acknowledgeSourceScanWakeup(input: {
  chainId: number;
  domain: SourceScanDomain;
  processedGeneration: string;
  continuationFromBlock?: string;
}): Promise<boolean> {
  const descriptor = sourceScanDescriptor(input.chainId, input.domain);
  const processed = BigInt(input.processedGeneration);
  const desired = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const intent = await tx.indexerScanIntent.findUnique({ where: { sourceKey: descriptor.sourceKey } });
    if (!intent) return null;
    const acknowledged = acknowledgeScanIntentState({
      desiredGeneration: intent.desiredGeneration,
      acknowledgedGeneration: intent.acknowledgedGeneration,
      requestedFinalizedTarget: intent.requestedFinalizedTarget,
      minimumRescanBoundary: intent.minimumRescanBoundary,
      forceReconciliation: intent.forceReconciliation,
    }, processed);
    const nextState = input.domain === "identity" && acknowledged.requeueGeneration != null
      ? { ...acknowledged.state, requestedFinalizedTarget: null }
      : acknowledged.state;
    await tx.indexerScanIntent.update({ where: { sourceKey: descriptor.sourceKey }, data: nextState });
    return acknowledged.requeueGeneration;
  }, { isolationLevel: "Serializable" }), 10);
  if (desired == null) return false;
  const boss = await getBoss();
  const basePayload = {
    v: 2 as const, semanticGeneration: WORKER_SEMANTIC_GENERATION, chainId: input.chainId, requestedGeneration: desired.toString(10),
    registryAddress: descriptor.registryAddress, registryGeneration: descriptor.registryGeneration,
    configurationGeneration: descriptor.configurationGeneration,
  };
  const payload = input.domain === "identity" || input.domain === "validation"
    ? { ...basePayload, maxBlocks: undefined, continuationFromBlock: input.continuationFromBlock }
    : basePayload;
  await boss.send(descriptor.queue, payload, {
    priority: descriptor.priority,
    singletonKey: String(input.chainId),
  });
  return true;
}
export async function acknowledgeSolanaScanWakeup(
  processedGeneration: string,
): Promise<boolean> {
  const sourceKey = SOLANA_8004_IDENTITY_SOURCE_KEY;
  const processed = BigInt(processedGeneration);
  const desired = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const intent = await tx.indexerScanIntent.findUnique({ where: { sourceKey } });
    if (!intent) return null;
    const acknowledged = acknowledgeScanIntentState({
      desiredGeneration: intent.desiredGeneration,
      acknowledgedGeneration: intent.acknowledgedGeneration,
      requestedFinalizedTarget: intent.requestedFinalizedTarget,
      minimumRescanBoundary: intent.minimumRescanBoundary,
      forceReconciliation: intent.forceReconciliation,
    }, processed);
    await tx.indexerScanIntent.update({ where: { sourceKey }, data: acknowledged.state });
    return acknowledged.requeueGeneration;
  }, { isolationLevel: "Serializable" }), 10);
  if (desired == null) return false;
  const boss = await getBoss();
  await boss.send(INDEXER_QUEUES.SOLANA_8004_SNAPSHOT, {
    v: 2,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    requestedGeneration: desired.toString(10),
  }, {
    priority: INDEXER_PRIORITIES.SOLANA_8004_SNAPSHOT,
    singletonKey: "solana",
  });
  return true;
}
export async function registerScheduledScanIntent(domain: "identity" | "validation" | "reputation" | "solana-agents" | "solana-8004-trust"): Promise<string> {
  const sourceKey = domain === "solana-agents"
    ? SOLANA_8004_IDENTITY_SOURCE_KEY
    : domain === "solana-8004-trust"
      ? SOLANA_8004_TRUST_SOURCE_KEY
      : `scan:${domain}`;
  return requestScanIntent({ sourceKey, domain });
}
async function enqueueScan(queue: string, priority: number, domain: string): Promise<string | null> {
  const generation = await requestScanIntent({ sourceKey: `scan:${domain}`, domain });
  const boss = await getBoss();
  return boss.send(queue, { v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION, generation }, { priority, singletonKey: "scan" });
}
export const enqueueCatchupScan = async () =>
  await isBootstrapPhaseOpen("IDENTITY")
    ? enqueueScan(INDEXER_QUEUES.CATCHUP_SCAN, INDEXER_PRIORITIES.CATCHUP_SCAN, "identity")
    : null;
export const enqueueValidationScan = async () =>
  await isBootstrapPhaseOpen("TRUST")
    ? enqueueScan(INDEXER_QUEUES.VALIDATION_SCAN, INDEXER_PRIORITIES.VALIDATION_SCAN, "validation")
    : null;
export const enqueueFeedbackScan = async () =>
  await isBootstrapPhaseOpen("TRUST")
    ? enqueueScan(INDEXER_QUEUES.FEEDBACK_SCAN, INDEXER_PRIORITIES.FEEDBACK_SCAN, "reputation")
    : null;
export async function acknowledgeScanWakeup(input: {
  domain: "identity" | "validation" | "reputation";
  processedGeneration: string;
}): Promise<boolean> {
  const sourceKey = `scan:${input.domain}`;
  const processed = BigInt(input.processedGeneration);
  const desired = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const intent = await tx.indexerScanIntent.findUnique({ where: { sourceKey } });
    if (!intent) return null;
    const acknowledged = acknowledgeScanIntentState({
      desiredGeneration: intent.desiredGeneration,
      acknowledgedGeneration: intent.acknowledgedGeneration,
      requestedFinalizedTarget: intent.requestedFinalizedTarget,
      minimumRescanBoundary: intent.minimumRescanBoundary,
      forceReconciliation: intent.forceReconciliation,
    }, processed);
    await tx.indexerScanIntent.update({ where: { sourceKey }, data: acknowledged.state });
    return acknowledged.requeueGeneration;
  }, { isolationLevel: "Serializable" }), 10);
  if (desired == null) return false;
  const queue = input.domain === "identity"
    ? INDEXER_QUEUES.CATCHUP_SCAN
    : input.domain === "validation"
      ? INDEXER_QUEUES.VALIDATION_SCAN
      : INDEXER_QUEUES.FEEDBACK_SCAN;
  const priority = input.domain === "identity"
    ? INDEXER_PRIORITIES.CATCHUP_SCAN
    : input.domain === "validation"
      ? INDEXER_PRIORITIES.VALIDATION_SCAN
      : INDEXER_PRIORITIES.FEEDBACK_SCAN;
  const boss = await getBoss();
  await boss.send(queue, { v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION, generation: desired.toString(10) }, {
    priority,
    singletonKey: "scan",
  });
  return true;
}
export async function enqueueAgentSync(
  payload: AgentSyncEnqueuePayload,
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("IDENTITY")) return null;
  const boss = await getBoss();
  const agentId = String(payload.agentId);
  const data: AgentSyncPayload = {
    v: 2,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    ...payload,
    agentId,
    ...(payload.sourceSnapshot?.transactionHash ? {} : { executionKey: randomUUID() }),
  };
  return boss.send(INDEXER_QUEUES.AGENT_SYNC, data, {
    priority: INDEXER_PRIORITIES.AGENT_SYNC,
    singletonKey: agentSyncSingletonKey(data),
    singletonSeconds: 5 * 60,
    group: { id: agentSyncGroupId(data) },
    ...options,
  });
}
export async function enqueueAgentSyncBatch(
  entries: readonly { id: string; payload: AgentSyncEnqueuePayload }[],
): Promise<string[]> {
  if (!await isBootstrapPhaseOpen("IDENTITY")) return [];
  return insertAgentSyncEntries(entries);
}
async function insertAgentSyncEntries(
  entries: readonly { id: string; payload: AgentSyncEnqueuePayload }[],
  db?: Db,
): Promise<string[]> {
  if (entries.length === 0) return [];
  const boss = await getBoss();
  const uniqueEntries = uniqueBy(entries, (entry) => entry.id);
  const jobs: JobInsert<AgentSyncPayload>[] = uniqueEntries.map(({ id, payload }) => {
    const agentId = String(payload.agentId);
    return {
      id,
      data: {
        v: 2,
        semanticGeneration: WORKER_SEMANTIC_GENERATION,
        ...payload,
        agentId,
        ...(payload.sourceSnapshot?.transactionHash ? {} : { executionKey: id }),
      },
      priority: INDEXER_PRIORITIES.AGENT_SYNC,
      singletonKey: agentSyncSingletonKey({ ...payload, agentId }),
      singletonSeconds: 5 * 60,
      group: { id: agentSyncGroupId({ chainId: payload.chainId, agentId }) },
    };
  });
  return insertJobsInBatches(
    boss,
    INDEXER_QUEUES.AGENT_SYNC,
    jobs,
    INDEXER_JOB_INSERT_BATCH_SIZE,
    db,
  );
}
export function enqueueAgentSyncBatchInTx(
  tx: Prisma.TransactionClient,
  entries: readonly { id: string; payload: AgentSyncEnqueuePayload }[],
): Promise<string[]> {
  return insertAgentSyncEntries(entries, fromPrisma(tx));
}

export async function enqueueAgentSyncExecutionRetry(
  payload: AgentSyncPayload,
  startAfter: Date,
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("IDENTITY")) return null;
  const boss = await getBoss();
  return boss.send(INDEXER_QUEUES.AGENT_SYNC, payload, {
    priority: INDEXER_PRIORITIES.AGENT_SYNC,
    singletonKey: `execution-retry:${agentSyncSingletonKey(payload)}:${executionRetrySlot(startAfter)}`,
    singletonSeconds: EXECUTION_RETRY_DEDUP_SECONDS,
    group: { id: agentSyncGroupId(payload) },
    startAfter,
  });
}
async function sendChainCatchupWakeup(
  payload: { chainId: number; requestedGeneration: string; maxBlocks?: number },
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  const descriptor = sourceScanDescriptor(payload.chainId, "identity");
  const boss = await getBoss();
  return boss.send(INDEXER_QUEUES.CHAIN_CATCHUP, {
    v: 2,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    chainId: payload.chainId,
    maxBlocks: payload.maxBlocks,
    requestedGeneration: payload.requestedGeneration,
    registryAddress: descriptor.registryAddress,
    registryGeneration: descriptor.registryGeneration,
    configurationGeneration: descriptor.configurationGeneration,
  }, {
    priority: INDEXER_PRIORITIES.CHAIN_CATCHUP,
    singletonKey: String(payload.chainId),
    ...options,
  });
}
export async function enqueueChainCatchup(
  payload: { chainId: number; maxBlocks?: number; continuationFromBlock?: string },
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("IDENTITY")) return null;
  const descriptor = sourceScanDescriptor(payload.chainId, "identity");
  const requestedGeneration = await requestScanIntent({
    sourceKey: descriptor.sourceKey, domain: "identity", chainId: payload.chainId, registryAddress: descriptor.registryAddress,
  });
  if (!requestedGeneration) return null;
  return sendChainCatchupWakeup({
    chainId: payload.chainId,
    requestedGeneration,
    maxBlocks: payload.maxBlocks,
  }, options);
}
export async function enqueueChainCatchupWakeup(
  payload: { chainId: number; requestedGeneration?: string; maxBlocks?: number },
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("IDENTITY")) return null;
  const descriptor = sourceScanDescriptor(payload.chainId, "identity");
  let requestedGeneration = payload.requestedGeneration;
  if (!requestedGeneration) {
    const intent = await prisma.indexerScanIntent.findUnique({
      where: { sourceKey: descriptor.sourceKey },
      select: { desiredGeneration: true },
    });
    if (!intent) return enqueueChainCatchup({ chainId: payload.chainId, maxBlocks: payload.maxBlocks }, options);
    requestedGeneration = intent.desiredGeneration.toString(10);
  }
  if (!requestedGeneration) return null;
  return sendChainCatchupWakeup({
    chainId: payload.chainId,
    requestedGeneration,
    maxBlocks: payload.maxBlocks,
  }, options);
}
export async function enqueueIdentityRangeLeases(payloads: readonly IdentityRangeLeasePayloadData[]): Promise<number> {
  if (!await isBootstrapPhaseOpen("IDENTITY") || payloads.length === 0) return 0;
  const boss = await getBoss();
  const uniquePayloads = uniqueBy(
    payloads,
    (payload) => `${payload.leaseId}:${payload.revision}`,
  );
  const jobs: JobInsert<IdentityRangePayload>[] = uniquePayloads.map((payload) => ({
    data: { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION, ...payload },
    priority: INDEXER_PRIORITIES.CHAIN_CATCHUP_RANGE,
    singletonKey: `${payload.leaseId}:${payload.revision}`,
    singletonSeconds: 24 * 60 * 60,
  }));
  return insertJobCountInBatches(boss, INDEXER_QUEUES.CHAIN_CATCHUP_RANGE, jobs);
}
export async function enqueueFeedbackSync(
  payload: { chainId: number },
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("TRUST")) return null;
  const descriptor = sourceScanDescriptor(payload.chainId, "reputation");
  const requestedGeneration = await requestScanIntent({
    sourceKey: descriptor.sourceKey, domain: "reputation", chainId: payload.chainId, registryAddress: descriptor.registryAddress,
  });
  const boss = await getBoss();
  return boss.send(INDEXER_QUEUES.FEEDBACK_SYNC, {
    v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION, ...payload, requestedGeneration,
    registryAddress: descriptor.registryAddress, registryGeneration: descriptor.registryGeneration,
    configurationGeneration: descriptor.configurationGeneration,
  }, {
    priority: INDEXER_PRIORITIES.FEEDBACK_SYNC,
    singletonKey: String(payload.chainId),
    ...options,
  });
}
export async function enqueueFeedbackSyncBatch(chainIds: readonly number[]): Promise<number> {
  if (!await isBootstrapPhaseOpen("TRUST")) return 0;
  const uniqueChainIds = [...new Set(chainIds)];
  if (uniqueChainIds.length === 0) return 0;
  const entries = await mapWithConcurrency(uniqueChainIds, 4, async (chainId) => {
    const descriptor = sourceScanDescriptor(chainId, "reputation");
    const requestedGeneration = await requestScanIntent({
      sourceKey: descriptor.sourceKey,
      domain: "reputation",
      chainId,
      registryAddress: descriptor.registryAddress,
    });
    return { chainId, descriptor, requestedGeneration };
  });
  const boss = await getBoss();
  const jobs: JobInsert<FeedbackSyncPayload>[] = entries.map(({ chainId, descriptor, requestedGeneration }) => ({
    data: {
      v: 2,
      semanticGeneration: WORKER_SEMANTIC_GENERATION,
      chainId,
      requestedGeneration,
      registryAddress: descriptor.registryAddress,
      registryGeneration: descriptor.registryGeneration,
      configurationGeneration: descriptor.configurationGeneration,
    },
    priority: INDEXER_PRIORITIES.FEEDBACK_SYNC,
    singletonKey: String(chainId),
  }));
  return insertJobCountInBatches(boss, INDEXER_QUEUES.FEEDBACK_SYNC, jobs);
}
export async function enqueueValidationSync(
  payload: { chainId: number; maxBlocks?: number; continuationFromBlock?: string },
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("TRUST")) return null;
  const descriptor = sourceScanDescriptor(payload.chainId, "validation");
  const requestedGeneration = await requestScanIntent({
    sourceKey: descriptor.sourceKey, domain: "validation", chainId: payload.chainId, registryAddress: descriptor.registryAddress,
  });
  const boss = await getBoss();
  return boss.send(INDEXER_QUEUES.VALIDATION_SYNC, {
    v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION, ...payload, requestedGeneration,
    registryAddress: descriptor.registryAddress, registryGeneration: descriptor.registryGeneration,
    configurationGeneration: descriptor.configurationGeneration,
  }, {
    priority: INDEXER_PRIORITIES.VALIDATION_SYNC,
    singletonKey: String(payload.chainId),
    ...options,
  });
}
export async function enqueueSolana8004Snapshot(
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("IDENTITY")) return null;
  const requestedGeneration = await requestScanIntent({ sourceKey: SOLANA_8004_IDENTITY_SOURCE_KEY, domain: "solana-agents" });
  const boss = await getBoss();
  return boss.send(INDEXER_QUEUES.SOLANA_8004_SNAPSHOT, { v: 2, semanticGeneration: WORKER_SEMANTIC_GENERATION, requestedGeneration }, {
    priority: INDEXER_PRIORITIES.SOLANA_8004_SNAPSHOT,
    singletonKey: "solana",
    ...options,
  });
}
export async function enqueueSolana8004TrustScan(
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("TRUST")) return null;
  const requestedGeneration = await requestScanIntent({
    sourceKey: SOLANA_8004_TRUST_SOURCE_KEY,
    domain: "solana-8004-trust",
    chainId: 900001,
  });
  const boss = await getBoss();
  const data: Solana8004TrustScanPayload = {
    v: 1,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    requestedGeneration,
    executionKey: `scan:${requestedGeneration}`,
  };
  return boss.send(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, data, {
    priority: INDEXER_PRIORITIES.SOLANA_8004_TRUST_SCAN,
    singletonKey: `scan:${requestedGeneration}`,
    ...options,
  });
}

export async function enqueueSolana8004TrustScanContinuation(
  requestedGeneration: string | undefined,
  cursorToken: string,
  startAfter = 1,
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("TRUST")) return null;
  const boss = await getBoss();
  const executionKey = `continue:${requestedGeneration ?? "steady"}:${cursorToken}`;
  const data: Solana8004TrustScanPayload = {
    v: 1,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    requestedGeneration,
    executionKey,
  };
  return boss.send(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, data, {
    priority: INDEXER_PRIORITIES.SOLANA_8004_TRUST_SCAN,
    singletonKey: executionKey,
    startAfter,
  });
}

export async function acknowledgeSolana8004TrustScanWakeup(processedGeneration: string): Promise<boolean> {
  const processed = BigInt(processedGeneration);
  const desired = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const intent = await tx.indexerScanIntent.findUnique({ where: { sourceKey: SOLANA_8004_TRUST_SOURCE_KEY } });
    if (!intent) return null;
    const acknowledged = acknowledgeScanIntentState({
      desiredGeneration: intent.desiredGeneration,
      acknowledgedGeneration: intent.acknowledgedGeneration,
      requestedFinalizedTarget: intent.requestedFinalizedTarget,
      minimumRescanBoundary: intent.minimumRescanBoundary,
      forceReconciliation: intent.forceReconciliation,
    }, processed);
    await tx.indexerScanIntent.update({ where: { sourceKey: SOLANA_8004_TRUST_SOURCE_KEY }, data: acknowledged.state });
    return acknowledged.requeueGeneration;
  }, { isolationLevel: "Serializable" }), 10);
  if (desired == null) return false;
  const boss = await getBoss();
  const executionKey = `scan:${desired}`;
  await boss.send(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, {
    v: 1,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    requestedGeneration: desired.toString(10),
    executionKey,
  } satisfies Solana8004TrustScanPayload, {
    priority: INDEXER_PRIORITIES.SOLANA_8004_TRUST_SCAN,
    singletonKey: executionKey,
  });
  return true;
}

export async function enqueueSolana8004TrustScanExecutionRetry(
  payload: Solana8004TrustScanPayload,
  originalJobId: string,
  startAfter: Date,
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("TRUST")) return null;
  const boss = await getBoss();
  const executionKey = payload.executionKey ?? `legacy-job:${originalJobId}`;
  const retryPayload: Solana8004TrustScanPayload = { ...payload, executionKey };
  return boss.send(INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN, retryPayload, {
    priority: INDEXER_PRIORITIES.SOLANA_8004_TRUST_SCAN,
    singletonKey: `execution-retry:${executionKey}:${executionRetrySlot(startAfter)}`,
    singletonSeconds: EXECUTION_RETRY_DEDUP_SECONDS,
    startAfter,
  });
}

export async function enqueueSolana8004TrustSyncBatch(
  payloads: readonly { signature: string; slot: string }[],
): Promise<number> {
  if (!await isBootstrapPhaseOpen("TRUST") || payloads.length === 0) return 0;
  const boss = await getBoss();
  const unique = uniqueBy(payloads, (payload) => payload.signature);
  // Keep discovery durable in PostgreSQL and materialize only a bounded execution
  // window into pg-boss. Created/retry rows include future-dated work, so
  // transient RPC outages cannot be converted into an ever-growing deferred queue.
  const queueTargetDepth = solana8004TrustQueueTargetDepth(config.solana8004TrustTxBatchSize);
  // Queue-stat snapshots are intentionally coarse and even force-refreshes are
  // rate-limited by pg-boss. Admission control needs an exact current bound,
  // so use the same indexed bounded-count pattern as the agent-sync outbox.
  const { rows: occupancyRows } = await boss.getDb().executeSql(`
    SELECT COUNT(*)::int AS occupied
    FROM (
      SELECT 1
      FROM pgboss.job
      WHERE name = $1
        AND state <= 'active'
      LIMIT $2
    ) AS bounded_jobs
  `, [INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, queueTargetDepth]);
  const observedOutstanding = Number(occupancyRows[0]?.occupied);
  if (!Number.isSafeInteger(observedOutstanding) || observedOutstanding < 0) {
    throw new Error("Solana 8004 trust queue occupancy probe returned an invalid result");
  }
  const availableQueueSlots = Math.max(0, queueTargetDepth - observedOutstanding);
  if (availableQueueSlots === 0) return 0;
  const now = new Date();
  const failedRetryBefore = new Date(now.getTime() - SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS);
  const staleRunningBefore = new Date(now.getTime() - SOLANA_8004_TRUST_STALE_RUNNING_MS);
  const staleQueuedBefore = new Date(now.getTime() - SOLANA_8004_TRUST_STALE_QUEUE_RESERVATION_MS);
  return withSerializableRetry(
    () => prisma.$transaction(async (tx) => {
      // QUEUED is an application-level reservation. Updating it in the same
      // transaction as pg-boss insertion closes the crash window that previously
      // allowed every scan pass to enqueue the same durable signatures again.
      const reserved = await tx.$queryRaw<Array<{ signature: string; slot: bigint }>>(Prisma.sql`
        WITH candidates AS (
          SELECT signature
          FROM solana_8004_trust_signatures
          WHERE signature IN (${Prisma.join(unique.map((payload) => payload.signature))})
            AND (
              status = 'PENDING'
              OR (status = 'FAILED' AND updated_at <= ${failedRetryBefore})
              OR (status = 'RUNNING' AND updated_at <= ${staleRunningBefore})
              OR (status = 'QUEUED' AND updated_at <= ${staleQueuedBefore})
            )
          ORDER BY slot ASC, signature ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${availableQueueSlots}
        ), reserved AS (
          UPDATE solana_8004_trust_signatures AS target
          SET status = 'QUEUED', updated_at = ${now}
          FROM candidates
          WHERE target.signature = candidates.signature
          RETURNING target.signature, target.slot
        )
        SELECT signature, slot
        FROM reserved
        ORDER BY slot ASC, signature ASC
      `);
      if (reserved.length === 0) return 0;
      const jobs: JobInsert<Solana8004TrustSyncPayload>[] = reserved.map((payload) => ({
        data: {
          v: 1,
          semanticGeneration: WORKER_SEMANTIC_GENERATION,
          signature: payload.signature,
          slot: payload.slot.toString(10),
        },
        priority: INDEXER_PRIORITIES.SOLANA_8004_TRUST_SYNC,
        singletonKey: payload.signature,
      }));
      const inserted = await insertJobCountInBatches(
        boss,
        INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC,
        jobs,
        config.solana8004TrustTxBatchSize,
        fromPrisma(tx),
      );
      if (inserted !== reserved.length) {
        throw new Error(`Solana 8004 trust queue reservation inserted ${inserted}/${reserved.length} jobs`);
      }
      return inserted;
    }, { isolationLevel: "Serializable" }),
    10,
  );
}

export async function enqueueMetaplexSnapshot(
  options: Partial<Pick<SendOptions, "id" | "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("IDENTITY")) return null;
  const boss = await getBoss();
  const data: MetaplexSnapshotPayload = { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION };
  return boss.send(INDEXER_QUEUES.METAPLEX_SNAPSHOT, data, {
    priority: INDEXER_PRIORITIES.METAPLEX_SNAPSHOT,
    singletonKey: "metaplex-current-state",
    ...options,
  });
}
type ClusterReconcileInput = {
  chainId: number;
  agentId: number;
  sourceObservationKey?: string;
};
type PendingClusterEnqueue = {
  payload: ClusterReconcileInput;
  resolve(value: string | null): void;
  reject(error: unknown): void;
};
let pendingClusterEnqueues: PendingClusterEnqueue[] = [];
let clusterEnqueueTimer: NodeJS.Timeout | null = null;
async function flushClusterEnqueues(): Promise<void> {
  const requests = pendingClusterEnqueues;
  pendingClusterEnqueues = [];
  if (requests.length === 0) return;
  try {
    if (!await isBootstrapPhaseOpen("DERIVED")) {
      for (const request of requests) request.resolve(null);
      return;
    }
    const grouped = new Map<string, {
      id: string;
      payload: ClusterReconcileInput;
      requests: PendingClusterEnqueue[];
    }>();
    for (const request of requests) {
      const key = `${request.payload.chainId}:${request.payload.agentId}`;
      const existing = grouped.get(key);
      if (existing) existing.requests.push(request);
      else grouped.set(key, { id: randomUUID(), payload: request.payload, requests: [request] });
    }
    const boss = await getBoss();
    const groups = [...grouped.entries()];
    const inserted = new Set(await insertJobsInBatches(
      boss,
      INDEXER_QUEUES.CLUSTER_RECONCILE,
      groups.map(([, group]): JobInsert<ClusterReconcilePayload> => ({
        id: group.id,
        data: {
          v: 1,
          semanticGeneration: WORKER_SEMANTIC_GENERATION,
          ...group.payload,
        },
        priority: INDEXER_PRIORITIES.CLUSTER_RECONCILE,
        singletonKey: `${group.payload.chainId}:${group.payload.agentId}`,
        singletonSeconds: 10 * 60,
      })),
    ));
    for (const [, group] of groups) {
      const jobId = inserted.has(group.id) ? group.id : null;
      group.requests.forEach((request, index) => request.resolve(index === 0 ? jobId : null));
    }
  } catch (error) {
    for (const request of requests) request.reject(error);
  } finally {
    if (pendingClusterEnqueues.length > 0 && !clusterEnqueueTimer) {
      clusterEnqueueTimer = setTimeout(() => {
        clusterEnqueueTimer = null;
        void flushClusterEnqueues();
      }, CLUSTER_ENQUEUE_COALESCE_MS);
    }
  }
}
export function enqueueClusterReconcile(payload: ClusterReconcileInput): Promise<string | null> {
  return new Promise((resolve, reject) => {
    pendingClusterEnqueues.push({ payload, resolve, reject });
    if (clusterEnqueueTimer) return;
    clusterEnqueueTimer = setTimeout(() => {
      clusterEnqueueTimer = null;
      void flushClusterEnqueues();
    }, CLUSTER_ENQUEUE_COALESCE_MS);
  });
}
export async function enqueueSolanaMetadataHydration(payload: { asset: string; uri: string }): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("METADATA")) return null;
  const boss = await getBoss();
  const data: SolanaMetadataPayload = { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION, ...payload };
  return boss.send(INDEXER_QUEUES.SOLANA_METADATA, data, {
    priority: INDEXER_PRIORITIES.SOLANA_METADATA,
    singletonKey: payload.asset,
    startAfter: 30,
  });
}
export async function enqueueSolanaMetadataHydrationBatch(
  payloads: Array<{ asset: string; uri: string }>,
): Promise<number> {
  if (!await isBootstrapPhaseOpen("METADATA")) return 0;
  if (payloads.length === 0) return 0;
  const boss = await getBoss();
  const uniquePayloads = uniqueBy(payloads, (payload) => payload.asset);
  const jobs: JobInsert<SolanaMetadataPayload>[] = uniquePayloads.map((payload) => ({
    data: { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION, ...payload },
    priority: INDEXER_PRIORITIES.SOLANA_METADATA,
    singletonKey: payload.asset,
    startAfter: 30,
  }));
  return insertJobCountInBatches(boss, INDEXER_QUEUES.SOLANA_METADATA, jobs);
}
export async function enqueueAgentMetadataHydration(payload: { chainId: number; agentId: string | number | bigint; uri: string }): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("METADATA")) return null;
  const boss = await getBoss();
  const data: AgentMetadataPayload = {
    v: 1,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    chainId: payload.chainId,
    agentId: String(payload.agentId),
    uri: payload.uri,
  };
  return boss.send(INDEXER_QUEUES.AGENT_METADATA, data, {
    priority: INDEXER_PRIORITIES.AGENT_METADATA,
    singletonKey: `${payload.chainId}:${payload.agentId}`,
  });
}
export async function enqueueAgentMetadataHydrationBatch(
  payloads: Array<{ chainId: number; agentId: string | number | bigint; uri: string }>,
): Promise<number> {
  if (!await isBootstrapPhaseOpen("METADATA")) return 0;
  if (payloads.length === 0) return 0;
  const boss = await getBoss();
  const uniquePayloads = uniqueBy(
    payloads,
    (payload) => `${payload.chainId}:${payload.agentId}`,
  );
  const jobs: JobInsert<AgentMetadataPayload>[] = uniquePayloads.map((payload) => ({
    data: {
      v: 1,
      semanticGeneration: WORKER_SEMANTIC_GENERATION,
      chainId: payload.chainId,
      agentId: String(payload.agentId),
      uri: payload.uri,
    },
    priority: INDEXER_PRIORITIES.AGENT_METADATA,
    singletonKey: `${payload.chainId}:${payload.agentId}`,
  }));
  return insertJobCountInBatches(boss, INDEXER_QUEUES.AGENT_METADATA, jobs);
}
export async function enqueueRegistrationRefreshScan(): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("METADATA")) return null;
  const boss = await getBoss();
  const data: RegistrationRefreshScanPayload = {
    v: 1,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
  };
  return boss.send(INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN, data, {
    priority: INDEXER_PRIORITIES.REGISTRATION_REFRESH_SCAN,
    singletonKey: "scan",
  });
}
export async function enqueueScoreRecalculation(agentId: number, requestedVersion?: bigint): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("DERIVED")) return null;
  const boss = await getBoss();
  const data: ScoreRecalculatePayload = {
    v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION, agentId,
    requestedVersion: requestedVersion?.toString(10),
  };
  return boss.send(INDEXER_QUEUES.SCORE_RECALCULATE, data, {
    priority: INDEXER_PRIORITIES.SCORE_RECALCULATE,
    singletonKey: String(agentId),
  });
}
export async function enqueueScoreRecalculationBatch(agentIds: readonly number[]): Promise<number> {
  if (!await isBootstrapPhaseOpen("DERIVED")) return 0;
  const unique = [...new Set(agentIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (unique.length === 0) return 0;
  const boss = await getBoss();
  const jobs: JobInsert<ScoreRecalculatePayload>[] = unique.map((agentId) => ({
    data: { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION, agentId },
    priority: INDEXER_PRIORITIES.SCORE_RECALCULATE, singletonKey: String(agentId),
  }));
  return insertJobCountInBatches(boss, INDEXER_QUEUES.SCORE_RECALCULATE, jobs);
}
export async function enqueueScoreRepairScan(
  afterAgentId?: number,
  options: Partial<Pick<SendOptions, "startAfter">> = {},
): Promise<string | null> {
  if (!await isBootstrapPhaseOpen("DERIVED")) return null;
  const boss = await getBoss();
  const data: ScoreRepairScanPayload = { v: 1, semanticGeneration: WORKER_SEMANTIC_GENERATION, afterAgentId };
  return boss.send(INDEXER_QUEUES.SCORE_REPAIR_SCAN, data, {
    priority: INDEXER_PRIORITIES.SCORE_REPAIR_SCAN, singletonKey: "scan",
    ...options,
  });
}
