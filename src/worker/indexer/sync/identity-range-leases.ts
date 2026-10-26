import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { createCompletionLogLimiter } from "../../job-completion-log.js";
import { throwIfAborted } from "../lib/abort.js";
import type { ProgressCheckpoint } from "../lib/progress.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
import { currentEvmSourceDescriptor } from "../lib/source-descriptor.js";
import { nextCursorStart } from "../lib/source-cursor.js";
import {
  getChainByChainId,
  isErc8004IndexingEnabled,
} from "../chains.js";
import {
  classifyRpcError,
  getRpcFinalitySnapshot,
  redactRpcErrorText,
  withRpcFallback,
} from "./rpc.js";
import { resolveRegistryDeploymentBoundary } from "../lib/registry-deployment-boundary.js";
import {
  dispatchIdentityOutbox,
  orphanIdentityBranch,
  scanIdentityEvents,
} from "./identity-events.js";
import {
  allocateUncoveredBlockRanges,
  contiguousCompletedPrefix,
} from "../lib/range-lease-state.js";
import { Prisma } from "@/generated/prisma/client";
const RANGE_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  INVALIDATED: "INVALIDATED",
} as const;
const identityRangeFailureLog = createCompletionLogLimiter();
export type IdentityRangeLeasePayloadData = {
  leaseId: string;
  revision: number;
  sourceKey: string;
  chainId: number;
  registryAddress: string;
  registryGeneration: string;
  configurationGeneration: string;
  requestedGeneration?: string;
  fromBlock: string;
  toBlock: string;
  targetBlock: string;
  finalityPolicy: string;
};
export type IdentityRangePlan = {
  sourceKey: string;
  targetBlock: bigint;
  cursorBlock: bigint | null;
  complete: boolean;
  allocated: number;
  queueable: IdentityRangeLeasePayloadData[];
  previouslyEnqueued: number;
  nextBlock: string | null;
};
export type IdentityRangeExecutionResult = {
  leaseId: string;
  skipped: boolean;
  enqueued: number;
  decoded: number;
  rejected: number;
  advancedTo: bigint | null;
  targetBlock: bigint;
  complete: boolean;
  nextBlock: string | null;
};
type CursorCoverageRange = {
  fromBlock: bigint;
  toBlock: bigint;
  status: string;
  endBlockHash: string | null;
  sourceHead: bigint | null;
  canonicalHead: bigint | null;
  finalityPolicy: string | null;
};
type RangeRow = {
  id: string;
  revision: number;
  sourceKey: string;
  chainId: number;
  registryAddress: string | null;
  registryGeneration: string | null;
  requestedGeneration: bigint | null;
  fromBlock: bigint;
  toBlock: bigint;
  targetBlock: bigint;
  status: string;
  finalityPolicy: string | null;
  sourceHead: bigint | null;
  canonicalHead: bigint | null;
  endBlockHash: string | null;
};
function initialCursorBlock(deploymentBlock: bigint): bigint | null {
  return deploymentBlock > 0n ? deploymentBlock - 1n : null;
}
function compatibilityBlock(block: bigint | null): number | null {
  if (block == null) return null;
  return block > 2_147_483_647n ? 2_147_483_647 : Number(block);
}
async function sourceFence(tx: Prisma.TransactionClient, sourceKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sourceKey}, 0))`;
}
function rangePayload(row: RangeRow, configurationGeneration: string): IdentityRangeLeasePayloadData {
  if (!row.registryAddress || !row.registryGeneration || !row.finalityPolicy) {
    throw new Error(`identity range lease ${row.id} is missing source identity`);
  }
  return {
    leaseId: row.id,
    revision: row.revision,
    sourceKey: row.sourceKey,
    chainId: row.chainId,
    registryAddress: row.registryAddress,
    registryGeneration: row.registryGeneration,
    configurationGeneration,
    requestedGeneration: row.requestedGeneration?.toString(10),
    fromBlock: row.fromBlock.toString(10),
    toBlock: row.toBlock.toString(10),
    targetBlock: row.targetBlock.toString(10),
    finalityPolicy: row.finalityPolicy,
  };
}
function chooseBoundTarget(input: {
  finalized: bigint;
  requestedGeneration?: string;
  desiredGeneration: bigint | null;
  existingTarget: bigint | null;
}): bigint {
  if (input.existingTarget == null) return input.finalized;
  const processed = input.requestedGeneration == null ? input.desiredGeneration : BigInt(input.requestedGeneration);
  // A newer request arrived while an older generation was running. Merge it into the
  // active coverage target without allowing an ordinary retry to chase the live head.
  if (processed != null && input.desiredGeneration != null && input.desiredGeneration > processed) {
    return input.finalized > input.existingTarget ? input.finalized : input.existingTarget;
  }
  return input.existingTarget;
}
async function rewindForReorg(input: {
  sourceKey: string;
  chainId: number;
  rewindBlock: bigint;
  registryAddress: string;
  displacedBlockHash: string;
}): Promise<void> {
  await orphanIdentityBranch({
    chainId: input.chainId,
    registryAddress: input.registryAddress,
    displacedBlockHash: input.displacedBlockHash,
    displacedFromBlock: input.rewindBlock,
  });
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await sourceFence(tx, input.sourceKey);
    await tx.indexerRangeLease.updateMany({
      where: {
        sourceKey: input.sourceKey,
        toBlock: { gte: input.rewindBlock },
        status: { not: RANGE_STATUS.INVALIDATED },
      },
      data: {
        status: RANGE_STATUS.INVALIDATED,
        revision: { increment: 1 },
        holder: null,
        leaseUntil: null,
        completedAt: null,
        endBlockHash: null,
        error: "invalidated by canonical-chain rewind",
      },
    });
    const rewoundCursor = initialCursorBlock(input.rewindBlock);
    await tx.indexerSourceCursor.updateMany({
      where: { sourceKey: input.sourceKey },
      data: {
        blockNumber: rewoundCursor,
        blockHash: null,
        oldestUnresolvedGap: input.rewindBlock,
        lastAdvancedAt: new Date(),
      },
    });
    await tx.chain.updateMany({
      where: { chainId: input.chainId },
      data: {
        lastSyncedBlock: compatibilityBlock(rewoundCursor),
        lastSyncedBlockHash: null,
      },
    });
  }, { isolationLevel: "Serializable" }), 10);
}
async function verifyAndRepairCursorCanonicality(input: {
  chainId: number;
  sourceKey: string;
  registryAddress: string;
  deploymentBlock: bigint;
  signal?: AbortSignal;
}): Promise<void> {
  const cursor = await prisma.indexerSourceCursor.findUnique({
    where: { sourceKey: input.sourceKey },
    select: { blockNumber: true, blockHash: true },
  });
  if (cursor?.blockNumber == null || !cursor.blockHash) return;
  const canonicalHash = await withRpcFallback(input.chainId, async (client) => {
    const block = await client.getBlock({ blockNumber: cursor.blockNumber!, includeTransactions: false });
    return block.hash ?? null;
  }, { blockNumber: cursor.blockNumber, signal: input.signal, requiresArchive: true });
  if (canonicalHash && canonicalHash.toLowerCase() === cursor.blockHash.toLowerCase()) return;
  const configured = Number(process.env.EVM_REORG_OVERLAP_BLOCKS ?? "128");
  const overlap = BigInt(Number.isSafeInteger(configured) && configured >= 0 ? configured : 128);
  const candidate = cursor.blockNumber > overlap ? cursor.blockNumber - overlap : 0n;
  const rewindBlock = candidate > input.deploymentBlock ? candidate : input.deploymentBlock;
  logger.warn("identity source cursor canonical hash changed; invalidating affected range leases", {
    chainId: input.chainId,
    sourceKey: input.sourceKey,
    cursorBlock: cursor.blockNumber.toString(10),
    rewindBlock: rewindBlock.toString(10),
  }, "sync");
  await rewindForReorg({
    sourceKey: input.sourceKey,
    chainId: input.chainId,
    rewindBlock,
    registryAddress: input.registryAddress,
    displacedBlockHash: cursor.blockHash,
  });
}
export async function prepareIdentityRangePlan(input: {
  chainId: number;
  requestedGeneration?: string;
  maxBlocks: number;
  signal?: AbortSignal;
}): Promise<IdentityRangePlan> {
  throwIfAborted(input.signal);
  const chain = getChainByChainId(input.chainId);
  if (!chain) throw new Error(`Unsupported chain ${input.chainId}`);
  if (!isErc8004IndexingEnabled(chain)) {
    return { sourceKey: `evm:${input.chainId}:identity:disabled`, targetBlock: 0n, cursorBlock: null, complete: true, allocated: 0, queueable: [], previouslyEnqueued: 0, nextBlock: null };
  }
  const descriptor = currentEvmSourceDescriptor(input.chainId, "identity");
  const previouslyEnqueued = await dispatchIdentityOutbox(input.chainId);
  const finality = await getRpcFinalitySnapshot(input.chainId, input.signal);
  const deploymentBlock = await resolveRegistryDeploymentBoundary({
    chain,
    domain: "identity",
    sourceKey: descriptor.sourceKey,
    registryGeneration: descriptor.registryGeneration,
    finalizedHead: finality.finalized,
    finalizedHash: finality.finalizedHash,
    signal: input.signal,
  });
  await verifyAndRepairCursorCanonicality({
    chainId: input.chainId,
    sourceKey: descriptor.sourceKey,
    registryAddress: descriptor.registryAddress,
    deploymentBlock,
    signal: input.signal,
  });
  const rangeSize = BigInt(Math.max(1, input.maxBlocks));
  // Keep only a small source-local rolling window materialized in pg-boss.
  // RPC capacity is process-wide and shared across many chains, so deriving this
  // from per-resource transport concurrency overproduces hundreds of active or
  // queued range leases during bootstrap and defeats upstream backpressure.
  const sourcePrefetch = config.evmIdentityRangePrefetch;
  const now = new Date();
  const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await sourceFence(tx, descriptor.sourceKey);
    await tx.indexerRangeLease.updateMany({
      where: {
        sourceKey: descriptor.sourceKey,
        status: RANGE_STATUS.RUNNING,
        leaseUntil: { lt: now },
      },
      data: {
        status: RANGE_STATUS.PENDING,
        holder: null,
        leaseUntil: null,
        error: "range execution lease expired and was reclaimed",
      },
    });
    const intent = await tx.indexerScanIntent.findUnique({ where: { sourceKey: descriptor.sourceKey } });
    const targetBlock = chooseBoundTarget({
      finalized: finality.finalized,
      requestedGeneration: input.requestedGeneration,
      desiredGeneration: intent?.desiredGeneration ?? null,
      existingTarget: intent?.requestedFinalizedTarget ?? null,
    });
    if (intent) {
      await tx.indexerScanIntent.update({
        where: { sourceKey: descriptor.sourceKey },
        data: { requestedFinalizedTarget: targetBlock },
      });
    }
    const cursor = await tx.indexerSourceCursor.upsert({
      where: { sourceKey: descriptor.sourceKey },
      create: {
        sourceKey: descriptor.sourceKey,
        chainId: input.chainId,
        domain: "identity",
        registryAddress: descriptor.registryAddress,
        registryGeneration: descriptor.registryGeneration,
        blockNumber: initialCursorBlock(deploymentBlock),
        finalityPolicy: finality.policy,
        sourceHead: finality.latest,
        canonicalHead: finality.finalized,
        oldestUnresolvedGap: deploymentBlock,
      },
      update: {
        registryAddress: descriptor.registryAddress,
        registryGeneration: descriptor.registryGeneration,
        finalityPolicy: finality.policy,
        sourceHead: finality.latest,
        canonicalHead: finality.finalized,
      },
      select: { blockNumber: true },
    });
    const start = nextCursorStart({
      sourceKey: descriptor.sourceKey,
      deploymentBlock,
      persistedBlock: cursor.blockNumber,
      finalizedHead: targetBlock,
    });
    const existing = start > targetBlock
      ? []
      : await tx.$queryRaw<Array<{
        fromBlock: bigint;
        toBlock: bigint;
        status: string;
      }>>(Prisma.sql`
        SELECT
          from_block AS "fromBlock",
          to_block AS "toBlock",
          status
        FROM indexer_range_leases
        WHERE source_key = ${descriptor.sourceKey}
          AND status <> ${RANGE_STATUS.INVALIDATED}
          AND int8range(from_block, to_block, '[]') && int8range(${start}, ${targetBlock}, '[]')
        ORDER BY from_block ASC, to_block ASC
      `);
    const activeCount = existing.filter((lease) => lease.status === RANGE_STATUS.PENDING || lease.status === RANGE_STATUS.RUNNING || lease.status === RANGE_STATUS.FAILED).length;
    const allocations = allocateUncoveredBlockRanges({
      start,
      target: targetBlock,
      rangeSize,
      existing,
      limit: Math.max(0, sourcePrefetch - activeCount),
    });
    if (allocations.length > 0) {
      const invalidated = await tx.indexerRangeLease.findMany({
        where: {
          sourceKey: descriptor.sourceKey,
          status: RANGE_STATUS.INVALIDATED,
          OR: allocations.map((allocation) => ({
            fromBlock: allocation.fromBlock,
            toBlock: allocation.toBlock,
          })),
        },
        select: { id: true, fromBlock: true, toBlock: true },
      });
      const requestedGeneration = input.requestedGeneration
        ? BigInt(input.requestedGeneration)
        : intent?.desiredGeneration;
      if (invalidated.length > 0) {
        await tx.indexerRangeLease.updateMany({
          where: { id: { in: invalidated.map((lease) => lease.id) }, status: RANGE_STATUS.INVALIDATED },
          data: {
            chainId: input.chainId,
            domain: "identity",
            registryAddress: descriptor.registryAddress,
            registryGeneration: descriptor.registryGeneration,
            requestedGeneration,
            revision: { increment: 1 },
            targetBlock,
            status: RANGE_STATUS.PENDING,
            holder: null,
            leaseUntil: null,
            finalityPolicy: finality.policy,
            sourceHead: finality.latest,
            canonicalHead: finality.finalized,
            endBlockHash: null,
            discoveredCount: 0,
            decodedCount: 0,
            rejectedCount: 0,
            completedAt: null,
            error: null,
          },
        });
      }
      const revived = new Set(invalidated.map((lease) => `${lease.fromBlock}:${lease.toBlock}`));
      const fresh = allocations.filter((allocation) =>
        !revived.has(`${allocation.fromBlock}:${allocation.toBlock}`),
      );
      if (fresh.length > 0) {
        await tx.indexerRangeLease.createMany({
          data: fresh.map((allocation) => ({
            sourceKey: descriptor.sourceKey,
            chainId: input.chainId,
            domain: "identity",
            registryAddress: descriptor.registryAddress,
            registryGeneration: descriptor.registryGeneration,
            requestedGeneration,
            fromBlock: allocation.fromBlock,
            toBlock: allocation.toBlock,
            targetBlock,
            status: RANGE_STATUS.PENDING,
            finalityPolicy: finality.policy,
            sourceHead: finality.latest,
            canonicalHead: finality.finalized,
          })),
          skipDuplicates: true,
        });
      }
    }
    const queueable = await tx.indexerRangeLease.findMany({
      where: {
        sourceKey: descriptor.sourceKey,
        status: { in: [RANGE_STATUS.PENDING, RANGE_STATUS.FAILED] },
        fromBlock: { lte: targetBlock },
      },
      orderBy: { fromBlock: "asc" },
      take: sourcePrefetch,
      select: {
        id: true,
        revision: true,
        sourceKey: true,
        chainId: true,
        registryAddress: true,
        registryGeneration: true,
        requestedGeneration: true,
        fromBlock: true,
        toBlock: true,
        targetBlock: true,
        status: true,
        finalityPolicy: true,
        sourceHead: true,
        canonicalHead: true,
        endBlockHash: true,
      },
    });
    const cursorBlock = cursor.blockNumber;
    const complete = (cursorBlock ?? -1n) >= targetBlock;
    const nextBlock = complete ? null : start.toString(10);
    await tx.indexerSourceCursor.update({
      where: { sourceKey: descriptor.sourceKey },
      data: { oldestUnresolvedGap: complete ? null : start },
    });
    return {
      targetBlock,
      cursorBlock,
      complete,
      allocations: allocations.length,
      queueable,
      nextBlock,
    };
  }, { isolationLevel: "Serializable" }), 10);
  return {
    sourceKey: descriptor.sourceKey,
    targetBlock: result.targetBlock,
    cursorBlock: result.cursorBlock,
    complete: result.complete,
    allocated: result.allocations,
    queueable: result.queueable.map((row) => rangePayload(row, descriptor.configurationGeneration)),
    previouslyEnqueued,
    nextBlock: result.nextBlock,
  };
}
export async function claimIdentityRangeLease(input: {
  leaseId: string;
  revision: number;
  holder?: string;
}): Promise<{ holder: string; lease: RangeRow } | null> {
  const holder = input.holder ?? randomUUID();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + config.evmRangeLeaseTtlMs);
  const claimed = await prisma.indexerRangeLease.updateMany({
    where: {
      id: input.leaseId,
      revision: input.revision,
      OR: [
        { status: { in: [RANGE_STATUS.PENDING, RANGE_STATUS.FAILED] } },
        { status: RANGE_STATUS.RUNNING, leaseUntil: { lt: now } },
      ],
    },
    data: {
      status: RANGE_STATUS.RUNNING,
      holder,
      leaseUntil,
      completedAt: null,
      error: null,
    },
  });
  if (claimed.count !== 1) return null;
  const lease = await prisma.indexerRangeLease.findUnique({
    where: { id: input.leaseId },
    select: {
      id: true,
      revision: true,
      sourceKey: true,
      chainId: true,
      registryAddress: true,
      registryGeneration: true,
      requestedGeneration: true,
      fromBlock: true,
      toBlock: true,
      targetBlock: true,
      status: true,
      finalityPolicy: true,
      sourceHead: true,
      canonicalHead: true,
      endBlockHash: true,
    },
  });
  if (!lease) throw new Error(`claimed identity range lease ${input.leaseId} disappeared`);
  return { holder, lease };
}
async function heartbeatIdentityRangeLease(leaseId: string, revision: number, holder: string): Promise<boolean> {
  const updated = await prisma.indexerRangeLease.updateMany({
    where: { id: leaseId, revision, holder, status: RANGE_STATUS.RUNNING },
    data: { leaseUntil: new Date(Date.now() + config.evmRangeLeaseTtlMs) },
  });
  return updated.count === 1;
}
async function failIdentityRangeLease(input: {
  leaseId: string;
  revision: number;
  holder: string;
  error: unknown;
}): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await prisma.indexerRangeLease.updateMany({
    where: {
      id: input.leaseId,
      revision: input.revision,
      holder: input.holder,
      status: RANGE_STATUS.RUNNING,
    },
    data: {
      status: RANGE_STATUS.FAILED,
      revision: { increment: 1 },
      holder: null,
      leaseUntil: null,
      error: message.slice(0, 4_000),
    },
  });
}
async function readSourceCompletion(input: {
  sourceKey: string;
  fallbackTarget: bigint;
}): Promise<{
  advancedTo: bigint | null;
  targetBlock: bigint;
  complete: boolean;
  nextBlock: string | null;
}> {
  const [cursor, intent] = await prisma.$transaction([
    prisma.indexerSourceCursor.findUnique({
      where: { sourceKey: input.sourceKey },
      select: { blockNumber: true, oldestUnresolvedGap: true },
    }),
    prisma.indexerScanIntent.findUnique({
      where: { sourceKey: input.sourceKey },
      select: { requestedFinalizedTarget: true },
    }),
  ]);
  const targetBlock = intent?.requestedFinalizedTarget != null && intent.requestedFinalizedTarget > input.fallbackTarget
    ? intent.requestedFinalizedTarget
    : input.fallbackTarget;
  const advancedTo = cursor?.blockNumber ?? null;
  const complete = advancedTo != null && advancedTo >= targetBlock;
  const next = cursor?.oldestUnresolvedGap ?? (advancedTo == null ? null : advancedTo + 1n);
  return {
    advancedTo,
    targetBlock,
    complete,
    nextBlock: complete || next == null ? null : next.toString(10),
  };
}
async function completeAndAdvance(input: {
  lease: RangeRow;
  holder: string;
  endBlockHash: string;
  enqueued: number;
  decoded: number;
  rejected: number;
}): Promise<{ advancedTo: bigint | null; complete: boolean; nextBlock: string | null }> {
  const chain = getChainByChainId(input.lease.chainId);
  if (!chain) throw new Error(`Unsupported chain ${input.lease.chainId}`);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await sourceFence(tx, input.lease.sourceKey);
    const completed = await tx.indexerRangeLease.updateMany({
      where: {
        id: input.lease.id,
        revision: input.lease.revision,
        holder: input.holder,
        status: RANGE_STATUS.RUNNING,
      },
      data: {
        status: RANGE_STATUS.COMPLETE,
        holder: null,
        leaseUntil: null,
        endBlockHash: input.endBlockHash,
        discoveredCount: input.enqueued,
        decodedCount: input.decoded,
        rejectedCount: input.rejected,
        completedAt: new Date(),
        error: null,
      },
    });
    if (completed.count !== 1) throw new Error(`identity range lease ${input.lease.id} lost its execution fence`);
    const cursor = await tx.indexerSourceCursor.findUnique({ where: { sourceKey: input.lease.sourceKey } });
    if (!cursor) throw new Error(`identity source cursor ${input.lease.sourceKey} is missing`);
    const initialBlock = cursor.blockNumber == null
      ? cursor.oldestUnresolvedGap ?? input.lease.fromBlock
      : cursor.blockNumber + 1n;
    const leases: CursorCoverageRange[] = await tx.indexerRangeLease.findMany({
      where: {
        sourceKey: input.lease.sourceKey,
        status: { not: RANGE_STATUS.INVALIDATED },
        toBlock: { gte: initialBlock },
      },
      orderBy: [{ fromBlock: "asc" }, { toBlock: "asc" }],
      select: {
        fromBlock: true,
        toBlock: true,
        status: true,
        endBlockHash: true,
        sourceHead: true,
        canonicalHead: true,
        finalityPolicy: true,
      },
    });
    const contiguous = contiguousCompletedPrefix({
      cursorBlock: cursor.blockNumber,
      initialBlock,
      ranges: leases,
    });
    const lastConsumed = contiguous.consumed.at(-1);
    const advancedTo = contiguous.advancedTo;
    const advancedHash = contiguous.endBlockHash ?? cursor.blockHash;
    const sourceHead = lastConsumed?.sourceHead ?? cursor.sourceHead;
    const canonicalHead = lastConsumed?.canonicalHead ?? cursor.canonicalHead;
    const finalityPolicy = lastConsumed?.finalityPolicy ?? cursor.finalityPolicy;
    const expected = contiguous.nextBlock;
    const intent = await tx.indexerScanIntent.findUnique({
      where: { sourceKey: input.lease.sourceKey },
      select: { requestedFinalizedTarget: true },
    });
    const activeTarget = intent?.requestedFinalizedTarget != null && intent.requestedFinalizedTarget > input.lease.targetBlock
      ? intent.requestedFinalizedTarget
      : input.lease.targetBlock;
    const complete = advancedTo != null && advancedTo >= activeTarget;
    const oldestUnresolvedGap = complete ? null : expected;
    if (advancedTo !== cursor.blockNumber) {
      await tx.indexerSourceCursor.update({
        where: { sourceKey: input.lease.sourceKey },
        data: {
          blockNumber: advancedTo,
          blockHash: advancedHash,
          sourceHead,
          canonicalHead,
          finalityPolicy,
          oldestUnresolvedGap,
          lastAdvancedAt: new Date(),
        },
      });
      await tx.chain.upsert({
        where: { chainId: input.lease.chainId },
        create: {
          chainId: input.lease.chainId,
          name: chain.name,
          shortName: chain.shortName,
          icon: "",
          color: "#888",
          identityRegistry: chain.identityRegistry,
          reputationRegistry: chain.reputationRegistry,
          validationRegistry: chain.validationRegistry,
          lastSyncedBlock: compatibilityBlock(advancedTo),
          lastSyncedBlockHash: advancedHash,
          lastFinalizedBlock: canonicalHead,
          finalityPolicy,
        },
        update: {
          lastSyncedBlock: compatibilityBlock(advancedTo),
          lastSyncedBlockHash: advancedHash,
          lastFinalizedBlock: canonicalHead,
          finalityPolicy,
        },
      });
    } else {
      await tx.indexerSourceCursor.update({
        where: { sourceKey: input.lease.sourceKey },
        data: { oldestUnresolvedGap },
      });
    }
    return {
      advancedTo,
      complete,
      nextBlock: complete ? null : expected.toString(10),
    };
  }, { isolationLevel: "Serializable" }), 10);
}
export async function executeIdentityRangeLease(input: {
  payload: IdentityRangeLeasePayloadData;
  jobId: string;
  signal?: AbortSignal;
  checkpoint?: ProgressCheckpoint;
}): Promise<IdentityRangeExecutionResult> {
  throwIfAborted(input.signal);
  const descriptor = currentEvmSourceDescriptor(input.payload.chainId, "identity");
  if (
    descriptor.sourceKey !== input.payload.sourceKey ||
    descriptor.registryAddress.toLowerCase() !== input.payload.registryAddress.toLowerCase() ||
    descriptor.registryGeneration !== input.payload.registryGeneration ||
    descriptor.configurationGeneration !== input.payload.configurationGeneration
  ) {
    return {
      leaseId: input.payload.leaseId,
      skipped: true,
      enqueued: 0,
      decoded: 0,
      rejected: 0,
      advancedTo: null,
      targetBlock: BigInt(input.payload.targetBlock),
      complete: false,
      nextBlock: input.payload.fromBlock,
    };
  }
  const claimed = await claimIdentityRangeLease({
    leaseId: input.payload.leaseId,
    revision: input.payload.revision,
    holder: input.jobId,
  });
  if (!claimed) {
    const current = await prisma.indexerRangeLease.findUnique({
      where: { id: input.payload.leaseId },
      select: { sourceKey: true, targetBlock: true },
    });
    const source = await readSourceCompletion({
      sourceKey: current?.sourceKey ?? input.payload.sourceKey,
      fallbackTarget: current?.targetBlock ?? BigInt(input.payload.targetBlock),
    });
    return {
      leaseId: input.payload.leaseId,
      skipped: true,
      enqueued: 0,
      decoded: 0,
      rejected: 0,
      advancedTo: source.advancedTo,
      targetBlock: source.targetBlock,
      complete: source.complete,
      nextBlock: source.nextBlock,
    };
  }
  const localAbort = new AbortController();
  const combinedSignal = input.signal ? AbortSignal.any([input.signal, localAbort.signal]) : localAbort.signal;
  const heartbeat = setInterval(() => {
    void heartbeatIdentityRangeLease(claimed.lease.id, claimed.lease.revision, claimed.holder)
      .then((held) => {
        if (!held && !localAbort.signal.aborted) localAbort.abort(new Error("identity range lease was lost"));
      })
      .catch((error) => {
        if (!localAbort.signal.aborted) localAbort.abort(error);
      });
  }, config.evmRangeLeaseHeartbeatMs);
  heartbeat.unref?.();
  try {
    const fromBlock = claimed.lease.fromBlock;
    const toBlock = claimed.lease.toBlock;
    const scanned = await scanIdentityEvents({
      chainId: claimed.lease.chainId,
      registryAddress: claimed.lease.registryAddress!,
      fromBlock,
      toBlock,
      chunkMax: Math.min(config.catchupGetLogsChunkMax, Number(toBlock - fromBlock + 1n)),
      finalityPolicy: claimed.lease.finalityPolicy!,
      signal: combinedSignal,
      checkpoint: input.checkpoint,
    });
    throwIfAborted(combinedSignal);
    const endBlockHash = await withRpcFallback(claimed.lease.chainId, async (client) => {
      const block = await client.getBlock({ blockNumber: toBlock, includeTransactions: false });
      if (!block.hash) throw new Error(`identity range boundary ${toBlock} has no block hash`);
      return block.hash;
    }, { blockNumber: toBlock, signal: combinedSignal, requiresArchive: true });
    const advanced = await completeAndAdvance({
      lease: claimed.lease,
      holder: claimed.holder,
      endBlockHash,
      enqueued: scanned.enqueued,
      decoded: scanned.decoded,
      rejected: scanned.malformed,
    });
    await input.checkpoint?.({
      phase: "identity-range-complete",
      chainId: claimed.lease.chainId,
      leaseId: claimed.lease.id,
      fromBlock: fromBlock.toString(10),
      toBlock: toBlock.toString(10),
      advancedTo: advanced.advancedTo?.toString(10) ?? null,
    });
    return {
      leaseId: claimed.lease.id,
      skipped: false,
      enqueued: scanned.enqueued,
      decoded: scanned.decoded,
      rejected: scanned.malformed,
      advancedTo: advanced.advancedTo,
      targetBlock: claimed.lease.targetBlock,
      complete: advanced.complete,
      nextBlock: advanced.nextBlock,
    };
  } catch (error) {
    try {
      await failIdentityRangeLease({
        leaseId: claimed.lease.id,
        revision: claimed.lease.revision,
        holder: claimed.holder,
        error,
      });
    } catch (persistError) {
      throw new AggregateError(
        [error, persistError],
        `Identity range lease ${claimed.lease.id} and failure-state persistence both failed`,
      );
    }
    const classification = classifyRpcError(error);
    const errorName = error && typeof error === "object" ? Reflect.get(error, "name") : null;
    const reflectedMessage = error && typeof error === "object" ? Reflect.get(error, "message") : null;
    const errorMessage = typeof reflectedMessage === "string" ? reflectedMessage : String(error);
    const interrupted = errorName === "AbortError" || /operation was aborted/i.test(errorMessage);
    const summary = identityRangeFailureLog(
      `${claimed.lease.chainId}:${classification}:${interrupted ? "interrupted" : "failed"}`,
    );
    if (summary) {
      const detail = {
        chainId: claimed.lease.chainId,
        sourceKey: claimed.lease.sourceKey,
        leaseId: claimed.lease.id,
        fromBlock: claimed.lease.fromBlock.toString(10),
        toBlock: claimed.lease.toBlock.toString(10),
        classification,
        occurrencesSinceLastLog: summary.completedSinceLastLog,
        windowMs: summary.windowMs,
        error: redactRpcErrorText(errorMessage),
      };
      if (interrupted) {
        logger.info("identity range lease interrupted", detail, "sync");
      } else {
        logger.warn("identity range lease failed", detail, "sync");
      }
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
