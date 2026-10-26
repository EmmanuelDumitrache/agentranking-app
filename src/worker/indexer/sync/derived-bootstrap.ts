import { createHash } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { rebuildAllClusterKeys } from "./cluster-assignment.js";
import { refreshDerivedChainCounts } from "./derived-chain-counts.js";
import { hasStaleScoreAgents } from "./score-recalculation.js";
import { runRankProjectionQueries } from "../../../lib/compute-ranks-queries.js";
import { DERIVED_SCORE_SOURCE_KEY, invalidateBootstrapStateCache } from "../queue/bootstrap-state.js";
import { INDEXER_QUEUES } from "../queue/queues.js";
import { enqueueBootstrapAdvance, enqueueScoreRepairScan } from "../queue/producer.js";
import type { DerivedFinalizePayload } from "../queue/contracts.js";
import { JOB_QUEUES } from "../../../jobs/queues.js";
import { config } from "../config.js";
import { sourceCursorResourceKey } from "../resources/resource-key.js";
import { createResourceProfile } from "../resources/resource-profile.js";
import { getOrCreateResourceScheduler } from "../resources/resource-scheduler.js";
import { indexerQueuesAreDrained } from "../queue/queue-occupancy.js";
export const DERIVED_STAGE_KEYS = [
  "derived:scores",
  "derived:clusters",
  "derived:chain-counts",
  "derived:ranks",
] as const;
export type DerivedStageKey = (typeof DERIVED_STAGE_KEYS)[number];
const FINAL_STAGE: DerivedStageKey = "derived:ranks";
const DERIVED_TRANSITION_ADVISORY_LOCK = 1_902_543_791;
function safeError(error: unknown): string {
  return (Error.isError(error) ? error.message : String(error)).slice(0, 4_000);
}
function publicationGeneration(payload: DerivedFinalizePayload): string {
  const digest = createHash("sha256")
    .update(`${payload.epochId}\0${payload.topologyHash}\0${payload.semanticGeneration ?? "unknown"}`)
    .digest("hex");
  return `derived-v1:${digest}`;
}
async function validateEpoch(payload: DerivedFinalizePayload): Promise<{
  id: string;
  topologyHash: string;
} | null> {
  const epoch = await prisma.indexerBootstrapEpoch.findUnique({
    where: { id: payload.epochId },
    select: { id: true, phase: true, status: true, topologyHash: true },
  });
  if (
    !epoch ||
    epoch.status !== "RUNNING" ||
    epoch.phase !== "DERIVED" ||
    epoch.topologyHash !== payload.topologyHash
  ) return null;
  return { id: epoch.id, topologyHash: epoch.topologyHash };
}
async function ensureWorkItems(epochId: string): Promise<void> {
  await prisma.indexerBootstrapWorkItem.createMany({
    data: DERIVED_STAGE_KEYS.map((workKey) => ({
      epochId,
      workKey,
      phase: "DERIVED" as const,
      sourceKey: DERIVED_SCORE_SOURCE_KEY,
    })),
    skipDuplicates: true,
  });
}
async function loadNextStage(epochId: string): Promise<DerivedStageKey | null> {
  const rows = await prisma.indexerBootstrapWorkItem.findMany({
    where: { epochId, phase: "DERIVED", workKey: { in: [...DERIVED_STAGE_KEYS] } },
    select: { workKey: true, status: true },
  });
  const statuses = new Map(rows.map((row) => [row.workKey, row.status]));
  for (const stage of DERIVED_STAGE_KEYS) {
    if (statuses.get(stage) !== "COMPLETE") return stage;
  }
  return null;
}
async function markStageRunning(epochId: string, stage: DerivedStageKey): Promise<void> {
  await prisma.indexerBootstrapWorkItem.update({
    where: { epochId_workKey: { epochId, workKey: stage } },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      startedAt: new Date(),
      completedAt: null,
      terminalReason: null,
      lastError: null,
    },
  });
}
async function markStageComplete(epochId: string, stage: DerivedStageKey, reason?: string): Promise<void> {
  await prisma.indexerBootstrapWorkItem.update({
    where: { epochId_workKey: { epochId, workKey: stage } },
    data: {
      status: "COMPLETE",
      completedAt: new Date(),
      terminalReason: reason?.slice(0, 1_000) ?? null,
      lastError: null,
    },
  });
}
async function markStageFailed(epochId: string, stage: DerivedStageKey, error: unknown): Promise<void> {
  await prisma.indexerBootstrapWorkItem.updateMany({
    where: { epochId, workKey: stage, phase: "DERIVED" },
    data: { status: "FAILED", lastError: safeError(error), completedAt: null },
  });
}
async function resetDerivedStages(epochId: string, fromStage: DerivedStageKey, reason: string): Promise<void> {
  const start = DERIVED_STAGE_KEYS.indexOf(fromStage);
  await prisma.indexerBootstrapWorkItem.updateMany({
    where: { epochId, workKey: { in: DERIVED_STAGE_KEYS.slice(start) } },
    data: {
      status: "PENDING",
      terminalReason: reason.slice(0, 1_000),
      lastError: null,
      startedAt: null,
      completedAt: null,
    },
  });
}
async function scoreBarrierSettled(boss: PgBoss): Promise<{ settled: boolean; stale: boolean }> {
  const stale = await hasStaleScoreAgents();
  if (stale) return { settled: false, stale };
  const settled = await indexerQueuesAreDrained(boss, [
    INDEXER_QUEUES.SCORE_REPAIR_SCAN,
    INDEXER_QUEUES.SCORE_RECALCULATE,
  ]);
  return { settled, stale };
}
async function wakeDerivedCoordinator(payload: DerivedFinalizePayload, reason: string, startAfter = 1): Promise<void> {
  await enqueueBootstrapAdvance({
    reason: `derived:${payload.epochId}:${reason}`,
    startAfter,
  });
}
async function waitForScores(boss: PgBoss, payload: DerivedFinalizePayload): Promise<boolean> {
  const barrier = await scoreBarrierSettled(boss);
  if (barrier.settled) return true;
  if (barrier.stale) await enqueueScoreRepairScan();
  await wakeDerivedCoordinator(payload, "waiting-for-scores", 2);
  return false;
}
async function assertScoreBarrierOrReset(
  boss: PgBoss,
  payload: DerivedFinalizePayload,
): Promise<boolean> {
  const barrier = await scoreBarrierSettled(boss);
  if (barrier.settled) return true;
  await resetDerivedStages(payload.epochId, "derived:scores", "score_state_changed_during_derived_publication");
  if (barrier.stale) await enqueueScoreRepairScan();
  await wakeDerivedCoordinator(payload, "score-barrier-reset", 2);
  return false;
}
async function waitForQueueDrain(
  boss: PgBoss,
  payload: DerivedFinalizePayload,
  stage: DerivedStageKey,
  queues: readonly string[],
): Promise<boolean> {
  if (await indexerQueuesAreDrained(boss, queues)) return true;
  await wakeDerivedCoordinator(payload, `waiting-for-${stage}`, 2);
  return false;
}
function stagePrerequisiteQueues(stage: DerivedStageKey): readonly string[] {
  if (stage === "derived:clusters") return [INDEXER_QUEUES.CLUSTER_RECONCILE];
  return [];
}
async function completeFinalStageAndEpoch(
  payload: DerivedFinalizePayload,
): Promise<boolean> {
  const now = new Date();
  const generation = publicationGeneration(payload);
  const transitioned = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DERIVED_TRANSITION_ADVISORY_LOCK})`;
    const epoch = await tx.indexerBootstrapEpoch.findUnique({
      where: { id: payload.epochId },
      select: { phase: true, status: true, topologyHash: true },
    });
    if (
      !epoch ||
      epoch.phase !== "DERIVED" ||
      epoch.status !== "RUNNING" ||
      epoch.topologyHash !== payload.topologyHash
    ) return false;
    const incompletePriorStage = await tx.indexerBootstrapWorkItem.findFirst({
      where: {
        epochId: payload.epochId,
        phase: "DERIVED",
        workKey: { in: DERIVED_STAGE_KEYS.filter((stage) => stage !== FINAL_STAGE) },
        status: { not: "COMPLETE" },
      },
      select: { workKey: true },
    });
    if (incompletePriorStage) return false;
    const [staleRow] = await tx.$queryRaw<Array<{ stale: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "Agent"
        WHERE "score_state_version" > "score_materialized_version"
        LIMIT 1
      ) AS stale
    `;
    if (staleRow?.stale) return false;
    await tx.indexerBootstrapWorkItem.update({
      where: { epochId_workKey: { epochId: payload.epochId, workKey: FINAL_STAGE } },
      data: {
        status: "COMPLETE",
        completedAt: now,
        terminalReason: generation,
        lastError: null,
      },
    });
    await tx.indexerBootstrapSource.updateMany({
      where: {
        epochId: payload.epochId,
        phase: "DERIVED",
        sourceKey: DERIVED_SCORE_SOURCE_KEY,
      },
      data: {
        status: "COMPLETE",
        completedAt: now,
        degradedReason: null,
        lastError: null,
      },
    });
    await tx.indexerBootstrapEpoch.update({
      where: { id: payload.epochId },
      data: {
        phase: "STEADY",
        status: "COMPLETE",
        phaseStartedAt: now,
        completedAt: now,
        publicationGeneration: generation,
        publishedAt: now,
      },
    });
    return true;
  }, { isolationLevel: "Serializable", timeout: 120_000, maxWait: 30_000 });
  if (!transitioned) return false;
  await invalidateBootstrapStateCache();
  logger.info("indexer bootstrap derived publication committed", {
    epochId: payload.epochId,
    topologyHash: payload.topologyHash,
    publicationGeneration: generation,
  }, "queue");
  return true;
}
async function runDerivedFinalizeJobWithinLease(
  boss: PgBoss,
  payload: DerivedFinalizePayload,
): Promise<{ status: "superseded" | "waiting" | "advanced" | "steady"; stage?: DerivedStageKey }> {
  const epoch = await validateEpoch(payload);
  if (!epoch) return { status: "superseded" };
  await ensureWorkItems(epoch.id);
  const stage = await loadNextStage(epoch.id);
  if (!stage) {
    const transitioned = await completeFinalStageAndEpoch(payload);
    return { status: transitioned ? "steady" : "waiting" };
  }
  if (stage !== "derived:scores" && !await assertScoreBarrierOrReset(boss, payload)) {
    return { status: "waiting", stage: "derived:scores" };
  }
  if (stage === "derived:scores" && !await waitForScores(boss, payload)) {
    return { status: "waiting", stage };
  }
  const prerequisiteQueues = stagePrerequisiteQueues(stage);
  if (prerequisiteQueues.length > 0 && !await waitForQueueDrain(boss, payload, stage, prerequisiteQueues)) {
    return { status: "waiting", stage };
  }
  await markStageRunning(epoch.id, stage);
  try {
    if (stage === "derived:scores") {
      await markStageComplete(epoch.id, stage, "score_materialization_barrier_settled");
    } else if (stage === "derived:clusters") {
      const result = await rebuildAllClusterKeys();
      await markStageComplete(epoch.id, stage, JSON.stringify(result));
    } else if (stage === "derived:chain-counts") {
      const result = await refreshDerivedChainCounts();
      await markStageComplete(epoch.id, stage, JSON.stringify(result));
    } else if (stage === "derived:ranks") {
      await runRankProjectionQueries(prisma);
      if (!await assertScoreBarrierOrReset(boss, payload)) {
        return { status: "waiting", stage: "derived:scores" };
      }
      const transitioned = await completeFinalStageAndEpoch(payload);
      if (!transitioned) {
        await wakeDerivedCoordinator(payload, "final-transition-retry", 2);
        return { status: "waiting", stage };
      }
      return { status: "steady", stage };
    }
    await wakeDerivedCoordinator(payload, `stage-complete:${stage}`);
    return { status: "advanced", stage };
  } catch (error) {
    try {
      await markStageFailed(epoch.id, stage, error);
    } catch (persistError) {
      throw new AggregateError(
        [error, persistError],
        `Derived bootstrap stage ${stage} and failure-state persistence both failed`,
      );
    }
    throw error;
  }
}
const DERIVED_FINALIZER_PROFILE = createResourceProfile({
  minCapacity: 1,
  maxCapacity: 1,
  successWindow: 1,
  decreaseFactor: 0.5,
  leaseTtlMs: config.resourceLeaseTtlMs,
  leaseHeartbeatMs: config.resourceLeaseHeartbeatMs,
  leaseAcquirePollMs: config.resourceLeaseAcquirePollMs,
});
export async function runDerivedFinalizeJob(
  boss: PgBoss,
  payload: DerivedFinalizePayload,
  signal?: AbortSignal,
): Promise<{ status: "superseded" | "waiting" | "advanced" | "steady"; stage?: DerivedStageKey }> {
  const scheduler = getOrCreateResourceScheduler(
    // Only one derived publication may consume this physical database lane at a
    // time. A stable key also prevents one scheduler/cache/state row from being
    // retained for every historical bootstrap epoch.
    sourceCursorResourceKey("bootstrap-derived"),
    DERIVED_FINALIZER_PROFILE,
  );
  return scheduler.run(
    () => runDerivedFinalizeJobWithinLease(boss, payload),
    { signal, priority: 100 },
  );
}
