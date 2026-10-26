import type { PgBoss } from "pg-boss";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import { getSyncableChainIds } from "../sync/rpc.js";
import { currentEvmSourceDescriptor } from "../lib/source-descriptor.js";
import { WORKER_SEMANTIC_GENERATION } from "./semantic-generation.js";
import { INDEXER_QUEUES } from "./queues.js";
import {
  DERIVED_SCORE_SOURCE_KEY,
  METAPLEX_IDENTITY_SOURCE_KEY,
  REGISTRATION_METADATA_SOURCE_KEY,
  SOLANA_8004_IDENTITY_SOURCE_KEY,
  SOLANA_8004_TRUST_SOURCE_KEY,
  bootstrapTopologyHash,
  invalidateBootstrapStateCache,
  nextBootstrapPhase,
  type IndexerBootstrapPhase,
} from "./bootstrap-state.js";
import {
  enqueueBootstrapAdvance,
  enqueueBootstrapAdvanceInTx,
  enqueueCatchupScan,
  enqueueDerivedFinalize,
  enqueueFeedbackScan,
  enqueueMetaplexSnapshot,
  enqueueRegistrationRefreshScan,
  enqueueScoreRepairScan,
  enqueueSolana8004Snapshot,
  enqueueSolana8004TrustScan,
  enqueueValidationScan,
} from "./producer.js";
import { indexerQueuesAreDrained } from "./queue-occupancy.js";
const COORDINATOR_ADVISORY_LOCK = 1_902_543_790;
const BOOTSTRAP_POLL_SECONDS = 15;
const TERMINAL_SOURCE_STATUSES = new Set(["COMPLETE", "TERMINAL_DEFERRED", "DEGRADED"]);
type BootstrapSourceSpec = {
  sourceKey: string;
  phase: IndexerBootstrapPhase;
  domain: string;
  required: boolean;
};
type ActiveEpoch = {
  id: string;
  phase: IndexerBootstrapPhase;
  topologyHash: string;
  strict: boolean;
  phaseStartedAt: Date;
  startedAt: Date;
  firstAgentMaterializedAt: Date | null;
  firstAgentDbId: number | null;
};
type EpochLoadResult = { epoch: ActiveEpoch | null; stateChanged: boolean };
function evmSourceSpecs(phase: "IDENTITY" | "TRUST"): BootstrapSourceSpec[] {
  const chainIds = getSyncableChainIds().filter((chainId) => chainId !== SOLANA_CHAIN_ID);
  if (phase === "IDENTITY") {
    return chainIds.map((chainId) => ({
      sourceKey: currentEvmSourceDescriptor(chainId, "identity").sourceKey,
      phase,
      domain: "identity",
      required: true,
    }));
  }
  return chainIds.flatMap((chainId) => ([
    {
      sourceKey: currentEvmSourceDescriptor(chainId, "reputation").sourceKey,
      phase,
      domain: "reputation",
      required: true,
    },
    {
      sourceKey: currentEvmSourceDescriptor(chainId, "validation").sourceKey,
      phase,
      domain: "validation",
      required: true,
    },
  ]));
}
export function bootstrapSourceSpecs(phase: IndexerBootstrapPhase): BootstrapSourceSpec[] {
  if (phase === "IDENTITY") {
    return [
      ...evmSourceSpecs("IDENTITY"),
      { sourceKey: SOLANA_8004_IDENTITY_SOURCE_KEY, phase, domain: "solana-8004-identity", required: true },
      { sourceKey: METAPLEX_IDENTITY_SOURCE_KEY, phase, domain: "metaplex-identity", required: true },
    ];
  }
  if (phase === "METADATA") {
    return [{ sourceKey: REGISTRATION_METADATA_SOURCE_KEY, phase, domain: "registration-metadata", required: true }];
  }
  if (phase === "TRUST") return [
    ...evmSourceSpecs("TRUST"),
    { sourceKey: SOLANA_8004_TRUST_SOURCE_KEY, phase, domain: "solana-8004-trust", required: true },
  ];
  if (phase === "DERIVED") {
    return [{ sourceKey: DERIVED_SCORE_SOURCE_KEY, phase, domain: "derived", required: true }];
  }
  return [];
}
async function loadOrCreateEpoch(): Promise<EpochLoadResult> {
  const topologyHash = bootstrapTopologyHash();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${COORDINATOR_ADVISORY_LOCK})`;
    const active = await tx.indexerBootstrapEpoch.findFirst({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        phase: true,
        topologyHash: true,
        strict: true,
        phaseStartedAt: true,
        startedAt: true,
        firstAgentMaterializedAt: true,
        firstAgentDbId: true,
      },
    });
    let topologyChanged = false;
    if (active) {
      if (active.topologyHash !== topologyHash) {
        topologyChanged = true;
        await tx.indexerBootstrapEpoch.update({
          where: { id: active.id },
          data: { status: "DEGRADED", completedAt: new Date() },
        });
      } else {
        return { epoch: active, stateChanged: false };
      }
    }
    const [agent, completedForTopology, priorEpoch] = await Promise.all([
      tx.agent.findFirst({ select: { id: true } }),
      tx.indexerBootstrapEpoch.findFirst({
        where: { topologyHash, phase: "STEADY", status: "COMPLETE" },
        orderBy: { completedAt: "desc" },
        select: { id: true },
      }),
      tx.indexerBootstrapEpoch.findFirst({ select: { id: true, topologyHash: true }, orderBy: { startedAt: "desc" } }),
    ]);
    // A retained epoch row cannot certify a database whose authoritative Agent table was cleared.
    if (agent && completedForTopology) return { epoch: null, stateChanged: false };
    topologyChanged ||= priorEpoch != null && priorEpoch.topologyHash !== topologyHash;
    if (agent && !topologyChanged && !priorEpoch) {
      await tx.indexerBootstrapEpoch.create({
        data: {
          semanticGeneration: WORKER_SEMANTIC_GENERATION,
          topologyHash,
          phase: "STEADY",
          status: "COMPLETE",
          strict: config.bootstrapStrict,
          completedAt: new Date(),
        },
      });
      return { epoch: null, stateChanged: true };
    }
    const created = await tx.indexerBootstrapEpoch.create({
      data: {
        semanticGeneration: WORKER_SEMANTIC_GENERATION,
        topologyHash,
        phase: "IDENTITY",
        strict: config.bootstrapStrict,
      },
      select: {
        id: true,
        phase: true,
        topologyHash: true,
        strict: true,
        phaseStartedAt: true,
        startedAt: true,
        firstAgentMaterializedAt: true,
        firstAgentDbId: true,
      },
    });
    return { epoch: created, stateChanged: true };
  }, { isolationLevel: "Serializable" });
}
async function ensurePhaseSources(epoch: ActiveEpoch): Promise<number> {
  const specs = bootstrapSourceSpecs(epoch.phase);
  if (specs.length === 0) return 0;
  const result = await prisma.indexerBootstrapSource.createMany({
    data: specs.map((source) => ({
      epochId: epoch.id,
      sourceKey: source.sourceKey,
      phase: source.phase,
      domain: source.domain,
      required: source.required,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
async function openPhaseWork(epoch: ActiveEpoch): Promise<void> {
  const pending = await prisma.indexerBootstrapSource.findFirst({
    where: { epochId: epoch.id, phase: epoch.phase, status: "PENDING" },
    select: { id: true },
  });
  if (!pending && epoch.phase !== "STEADY" && epoch.phase !== "DERIVED") return;
  if (epoch.phase === "IDENTITY") {
    await Promise.all([enqueueCatchupScan(), enqueueSolana8004Snapshot(), enqueueMetaplexSnapshot()]);
  } else if (epoch.phase === "METADATA") {
    await enqueueRegistrationRefreshScan();
  } else if (epoch.phase === "TRUST") {
    await Promise.all([enqueueFeedbackScan(), enqueueValidationScan(), enqueueSolana8004TrustScan()]);
  } else if (epoch.phase === "DERIVED") {
    await Promise.all([
      enqueueScoreRepairScan(),
      enqueueDerivedFinalize({
        v: 1,
        semanticGeneration: WORKER_SEMANTIC_GENERATION,
        epochId: epoch.id,
        topologyHash: epoch.topologyHash,
      }),
    ]);
  }
  await prisma.indexerBootstrapSource.updateMany({
    where: { epochId: epoch.id, phase: epoch.phase, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
}
function phaseQueues(phase: IndexerBootstrapPhase): string[] {
  if (phase === "IDENTITY") return [
    INDEXER_QUEUES.CATCHUP_SCAN,
    INDEXER_QUEUES.CHAIN_CATCHUP,
    INDEXER_QUEUES.CHAIN_CATCHUP_RANGE,
    INDEXER_QUEUES.AGENT_SYNC,
    INDEXER_QUEUES.SOLANA_8004_SNAPSHOT,
    INDEXER_QUEUES.METAPLEX_SNAPSHOT,
  ];
  if (phase === "METADATA") return [
    INDEXER_QUEUES.REGISTRATION_REFRESH_SCAN,
    INDEXER_QUEUES.AGENT_METADATA,
    INDEXER_QUEUES.SOLANA_METADATA,
  ];
  if (phase === "TRUST") return [
    INDEXER_QUEUES.FEEDBACK_SCAN,
    INDEXER_QUEUES.FEEDBACK_SYNC,
    INDEXER_QUEUES.VALIDATION_SCAN,
    INDEXER_QUEUES.VALIDATION_SYNC,
    INDEXER_QUEUES.SOLANA_8004_TRUST_SCAN,
    INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC,
  ];
  if (phase === "DERIVED") return [
    INDEXER_QUEUES.DERIVED_FINALIZE,
    INDEXER_QUEUES.SCORE_REPAIR_SCAN,
    INDEXER_QUEUES.SCORE_RECALCULATE,
    INDEXER_QUEUES.CLUSTER_RECONCILE,
  ];
  return [];
}
async function degradeExpiredSources(epoch: ActiveEpoch): Promise<void> {
  if (epoch.strict || epoch.phase === "DERIVED") return;
  const graceMs = epoch.phase === "METADATA"
    ? config.bootstrapMetadataGraceMs
    : config.bootstrapSourceGraceMs;
  const cutoff = new Date(Date.now() - graceMs);
  await prisma.indexerBootstrapSource.updateMany({
    where: {
      epochId: epoch.id,
      phase: epoch.phase,
      status: { in: ["RUNNING", "FAILED"] },
      startedAt: { lte: cutoff },
    },
    data: {
      status: "DEGRADED",
      degradedReason: "bootstrap_grace_period_exceeded",
      completedAt: new Date(),
    },
  });
}
async function phaseIsComplete(boss: PgBoss, epoch: ActiveEpoch): Promise<boolean> {
  await degradeExpiredSources(epoch);
  // Phase 4 owns its final read-model publication and STEADY transition atomically.
  if (epoch.phase === "DERIVED") return false;
  const sources = await prisma.indexerBootstrapSource.findMany({
    where: { epochId: epoch.id, phase: epoch.phase },
    select: { sourceKey: true, required: true, status: true },
  });
  if (sources.length === 0 || sources.some((source) => source.required && !TERMINAL_SOURCE_STATUSES.has(source.status))) {
    return false;
  }
  const hasDegradedSource = sources.some((source) => source.status === "DEGRADED");
  const queuesToDrain = hasDegradedSource && epoch.phase === "IDENTITY"
    ? [INDEXER_QUEUES.AGENT_SYNC]
    : hasDegradedSource
      ? []
      : phaseQueues(epoch.phase);
  if (!await indexerQueuesAreDrained(boss, queuesToDrain)) return false;
  if (epoch.phase === "IDENTITY") {
    const blockingIdentitySourceKeys = sources
      .filter((source) => source.status !== "DEGRADED")
      .map((source) => source.sourceKey);
    const [undispatched, unresolvedRange] = await Promise.all([
      prisma.indexerOutbox.findFirst({
        where: { queueName: INDEXER_QUEUES.AGENT_SYNC, dispatchedAt: null },
        select: { id: true },
      }),
      blockingIdentitySourceKeys.length === 0
        ? Promise.resolve(null)
        : prisma.indexerRangeLease.findFirst({
            where: {
              sourceKey: { in: blockingIdentitySourceKeys },
              domain: "identity",
              status: { in: ["PENDING", "RUNNING", "FAILED"] },
            },
            select: { id: true },
          }),
    ]);
    if (undispatched || unresolvedRange) return false;
  }
  const pendingWork = await prisma.indexerBootstrapWorkItem.findFirst({
    where: {
      epochId: epoch.id,
      phase: epoch.phase,
      status: { in: ["PENDING", "RUNNING", "FAILED"] },
    },
    select: { workKey: true },
  });
  return pendingWork == null;
}
async function transitionEpoch(epoch: ActiveEpoch): Promise<IndexerBootstrapPhase | null> {
  const next = nextBootstrapPhase(epoch.phase);
  const transitioned = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${COORDINATOR_ADVISORY_LOCK})`;
    const current = await tx.indexerBootstrapEpoch.findUnique({ where: { id: epoch.id } });
    if (!current || current.status !== "RUNNING" || current.phase !== epoch.phase) return false;
    if (next === "STEADY") {
      await tx.indexerBootstrapEpoch.update({
        where: { id: epoch.id },
        data: { phase: "STEADY", status: "COMPLETE", phaseStartedAt: new Date(), completedAt: new Date() },
      });
    } else {
      await tx.indexerBootstrapEpoch.update({
        where: { id: epoch.id },
        data: { phase: next, phaseStartedAt: new Date() },
      });
      await enqueueBootstrapAdvanceInTx(tx, { reason: `phase-transition:${epoch.phase}->${next}` });
    }
    return true;
  }, { isolationLevel: "Serializable" });
  if (!transitioned) {
    logger.info("indexer bootstrap phase transition was superseded", {
      epochId: epoch.id,
      expectedPhase: epoch.phase,
      requestedNextPhase: next,
    }, "queue");
    return null;
  }
  await invalidateBootstrapStateCache();
  logger.info("indexer bootstrap phase transitioned", {
    epochId: epoch.id,
    fromPhase: epoch.phase,
    toPhase: next,
    topologyHash: epoch.topologyHash,
  }, "queue");
  return next;
}
export async function runBootstrapAdvance(boss: PgBoss, _reason: string): Promise<void> {
  const { epoch, stateChanged } = await loadOrCreateEpoch();
  if (stateChanged) await invalidateBootstrapStateCache();
  if (!epoch) return;
  await ensurePhaseSources(epoch);
  await openPhaseWork(epoch);
  if (await phaseIsComplete(boss, epoch)) {
    await transitionEpoch(epoch);
    return;
  }
  await enqueueBootstrapAdvance({ reason: `phase-poll:${epoch.phase}`, startAfter: BOOTSTRAP_POLL_SECONDS });
}
