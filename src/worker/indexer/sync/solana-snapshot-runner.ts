import { prisma } from "../db.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import {
  POSTGRES_SIGNED_BIGINT_MAX,
  POSTGRES_SIGNED_INT_MAX,
  SOLANA_8004_IDENTITY_SOURCE_KEY,
  SOLANA_REGISTRY_SOURCE,
  type SnapshotDescriptor,
  type SolanaRegistrySource,
} from "./solana-current-state-types.js";
import {
  refreshSolanaRegistryAgentLifecycles,
} from "./solana-registry-lifecycle.js";
export { markMembershipSeen } from "./solana-registry-membership.js";
export type { SnapshotDescriptor } from "./solana-current-state-types.js";
import { throwIfAborted } from "../lib/abort.js";
import { acquireSolanaSnapshotTransitionFence } from "./solana-agent-locks.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
function assertDescriptor(descriptor: SnapshotDescriptor): void {
  if (!descriptor.registryAddress.trim()) throw new Error("snapshot registry address is required");
  if (descriptor.generation <= 0n || descriptor.generation > POSTGRES_SIGNED_BIGINT_MAX) {
    throw new Error("snapshot generation must fit a positive PostgreSQL BIGINT");
  }
  if (descriptor.sourceSlot != null && (descriptor.sourceSlot < 0n || descriptor.sourceSlot > POSTGRES_SIGNED_BIGINT_MAX)) {
    throw new Error("snapshot source slot must fit a non-negative PostgreSQL BIGINT");
  }
  if (descriptor.reportedCount != null && (!Number.isSafeInteger(descriptor.reportedCount) || descriptor.reportedCount < 0 || descriptor.reportedCount > POSTGRES_SIGNED_INT_MAX)) {
    throw new Error("snapshot reported count must fit a non-negative PostgreSQL INTEGER");
  }
  for (const [label, value] of Object.entries({
    inventoryCount: descriptor.inventoryCount,
    proofCount: descriptor.proofCount,
    terminalRejectCount: descriptor.terminalRejectCount,
  })) {
    if (value != null && (!Number.isSafeInteger(value) || value < 0 || value > POSTGRES_SIGNED_INT_MAX)) {
      throw new Error(`snapshot ${label} must fit a non-negative PostgreSQL INTEGER`);
    }
  }
  for (const [label, value] of Object.entries({
    inventoryStartSlot: descriptor.inventoryStartSlot,
    inventoryEndSlot: descriptor.inventoryEndSlot,
  })) {
    if (value != null && (value < 0n || value > POSTGRES_SIGNED_BIGINT_MAX)) {
      throw new Error(`snapshot ${label} must fit a non-negative PostgreSQL BIGINT`);
    }
  }
  for (const [label, value] of Object.entries({
    inventoryDigest: descriptor.inventoryDigest,
    idlHash: descriptor.idlHash,
    genesisHash: descriptor.genesisHash,
    programId: descriptor.programId,
    rpcEndpointKey: descriptor.rpcEndpointKey,
    configurationFingerprint: descriptor.configurationFingerprint,
    baseCollection: descriptor.baseCollection,
    rootConfigPda: descriptor.rootConfigPda,
    registryConfigPda: descriptor.registryConfigPda,
  })) {
    if (value != null && (!value.trim() || value.includes("\0"))) throw new Error(`snapshot ${label} is invalid`);
  }
}
export async function nextSnapshotGeneration(
  source: SolanaRegistrySource,
  generationFloor = 0n,
): Promise<bigint> {
  const latest = await prisma.solanaRegistrySnapshot.findFirst({
    where: { source },
    orderBy: { generation: "desc" },
    select: { generation: true },
  });
  const latestGeneration = latest?.generation ?? 0n;
  const floor = latestGeneration > generationFloor ? latestGeneration : generationFloor;
  if (floor >= POSTGRES_SIGNED_BIGINT_MAX) throw new Error(`${source} snapshot generation space is exhausted`);
  return floor + 1n;
}
export async function createSnapshot(
  descriptor: SnapshotDescriptor,
): Promise<void> {
  assertDescriptor(descriptor);
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    // Serialize generation start with all per-Agent source materialization.
    // This closes the race where a writer whose session mutex was lost could
    // pass its final source check immediately before a new generation starts.
    await acquireSolanaSnapshotTransitionFence(tx);
    const [latest, latestComplete] = await Promise.all([
      tx.solanaRegistrySnapshot.findFirst({
        where: { source: descriptor.source },
        orderBy: { generation: "desc" },
        select: { generation: true },
      }),
      tx.solanaRegistrySnapshot.findFirst({
        where: { source: descriptor.source, status: "complete" },
        orderBy: { generation: "desc" },
        select: { generation: true, sourceSlot: true },
      }),
    ]);
    if (latest && latest.generation >= descriptor.generation) {
      throw new Error(`${descriptor.source} snapshot generation ${descriptor.generation} is not newer than ${latest.generation}`);
    }
    if (latestComplete?.sourceSlot != null) {
      if (descriptor.sourceSlot == null) {
        throw new Error(
          `${descriptor.source} snapshot generation ${descriptor.generation} lost the finalized source coordinate from completed generation ${latestComplete.generation}`,
        );
      }
      if (descriptor.sourceSlot < latestComplete.sourceSlot) {
        throw new Error(
          `${descriptor.source} snapshot source slot regressed from ${latestComplete.sourceSlot} to ${descriptor.sourceSlot}`,
        );
      }
    }
    const running = await tx.solanaRegistrySnapshot.findFirst({
      where: { source: descriptor.source, status: "running" },
      orderBy: { generation: "desc" },
      select: { generation: true, startedAt: true },
    });
    if (running && running.generation !== descriptor.generation) {
      const interruptedBefore = Date.now() - 2 * 60 * 60 * 1000;
      if (running.startedAt.getTime() > interruptedBefore) {
        throw new Error(`${descriptor.source} snapshot generation ${running.generation} is already running`);
      }
      await tx.solanaRegistrySnapshot.update({
        where: {
          source_generation: {
            source: descriptor.source,
            generation: running.generation,
          },
        },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage: `superseded by generation ${descriptor.generation} after an interrupted run`,
        },
      });
    }
    await tx.solanaRegistrySnapshot.create({
      data: {
        source: descriptor.source,
        generation: descriptor.generation,
        status: "running",
        registryAddress: descriptor.registryAddress,
        sourceSlot: descriptor.sourceSlot,
        reportedCount: descriptor.reportedCount,
        inventoryCount: descriptor.inventoryCount ?? null,
        inventoryDigest: descriptor.inventoryDigest ?? null,
        proofCount: descriptor.proofCount ?? 0,
        terminalRejectCount: descriptor.terminalRejectCount ?? 0,
        rpcEndpointKey: descriptor.rpcEndpointKey ?? null,
        genesisHash: descriptor.genesisHash ?? null,
        programId: descriptor.programId ?? null,
        idlHash: descriptor.idlHash ?? null,
        configurationFingerprint: descriptor.configurationFingerprint ?? null,
        baseCollection: descriptor.baseCollection ?? null,
        rootConfigPda: descriptor.rootConfigPda ?? null,
        registryConfigPda: descriptor.registryConfigPda ?? null,
        inventoryStartSlot: descriptor.inventoryStartSlot ?? null,
        inventoryEndSlot: descriptor.inventoryEndSlot ?? null,
      },
    });
  }, { isolationLevel: "Serializable", timeout: 30_000, maxWait: 15_000 }), 8);
}
export async function failSnapshot(
  source: SolanaRegistrySource,
  generation: bigint,
  errorMessage: string,
): Promise<void> {
  await prisma.solanaRegistrySnapshot.updateMany({
    where: { source, generation, status: "running" },
    data: {
      status: "failed",
      errorMessage: errorMessage.replace(/\0/g, "").slice(0, 16_000),
      completedAt: new Date(),
    },
  });
}
export async function updateSnapshotProgress(input: {
  descriptor: SnapshotDescriptor;
  discoveredCount: number;
  indexedCount: number;
  rejectedCount: number;
}): Promise<void> {
  assertDescriptor(input.descriptor);
  for (const [name, value] of Object.entries({
    discoveredCount: input.discoveredCount,
    indexedCount: input.indexedCount,
    rejectedCount: input.rejectedCount,
  })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > POSTGRES_SIGNED_INT_MAX) {
      throw new Error(`${name} must fit a non-negative PostgreSQL INTEGER`);
    }
  }
  const updated = await prisma.solanaRegistrySnapshot.updateMany({
    where: {
      source: input.descriptor.source,
      generation: input.descriptor.generation,
      status: "running",
      registryAddress: input.descriptor.registryAddress,
      sourceSlot: input.descriptor.sourceSlot,
      reportedCount: input.descriptor.reportedCount,
    },
    data: {
      discoveredCount: input.discoveredCount,
      indexedCount: input.indexedCount,
      rejectedCount: input.rejectedCount,
      terminalRejectCount: input.descriptor.terminalRejectCount ?? input.rejectedCount,
      proofCount: input.descriptor.proofCount ?? 0,
      inventoryDigest: input.descriptor.inventoryDigest ?? null,
      configurationFingerprint: input.descriptor.configurationFingerprint ?? null,
      baseCollection: input.descriptor.baseCollection ?? null,
      rootConfigPda: input.descriptor.rootConfigPda ?? null,
      registryConfigPda: input.descriptor.registryConfigPda ?? null,
      inventoryEndSlot: input.descriptor.inventoryEndSlot ?? null,
    },
  });
  if (updated.count !== 1) {
    throw new Error(`${input.descriptor.source} generation ${input.descriptor.generation} is no longer running`);
  }
}
export async function assertMembershipsNotSeen(
  descriptor: SnapshotDescriptor,
  externalIds: readonly string[],
): Promise<void> {
  assertDescriptor(descriptor);
  const unique = new Set<string>();
  for (const externalId of externalIds) {
    if (!externalId.trim()) throw new Error("snapshot external ID is required");
    if (unique.has(externalId)) {
      throw new Error(`duplicate ${descriptor.source} external ID ${externalId} in generation ${descriptor.generation}`);
    }
    unique.add(externalId);
  }
  const ids = [...unique];
  for (let offset = 0; offset < ids.length; offset += 5_000) {
    const existing = await prisma.solanaRegistryMembership.findFirst({
      where: {
        source: descriptor.source,
        externalId: { in: ids.slice(offset, offset + 5_000) },
        lastSeenGeneration: { gte: descriptor.generation },
      },
      select: { externalId: true, lastSeenGeneration: true },
    });
    if (existing) {
      const kind = existing.lastSeenGeneration === descriptor.generation ? "duplicate" : "stale-generation";
      throw new Error(`${kind} ${descriptor.source} external ID ${existing.externalId} in generation ${descriptor.generation}`);
    }
  }
}
export async function finalizeSnapshot(
  descriptor: SnapshotDescriptor,
  discoveredCount: number,
  indexedCount: number,
  rejectedCount: number,
  signal?: AbortSignal,
  options: { membershipInventoryUnchanged?: boolean } = {},
): Promise<void> {
  assertDescriptor(descriptor);
  throwIfAborted(signal);
  const directSolana8004 = descriptor.source === SOLANA_REGISTRY_SOURCE.SOLANA_8004;
  const metaplexCurrentState = descriptor.source === SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY;
  if (options.membershipInventoryUnchanged && !directSolana8004 && !metaplexCurrentState) {
    throw new Error("unchanged membership inventory is only valid for authoritative Solana snapshots");
  }
  if (directSolana8004) {
    if (descriptor.inventoryCount == null || descriptor.inventoryCount !== discoveredCount) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation}: inventory count does not match discovered count`);
    }
    if (!descriptor.inventoryDigest || descriptor.inventoryStartSlot == null || descriptor.inventoryEndSlot == null) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation} without stable inventory evidence`);
    }
    if (!descriptor.configurationFingerprint || !descriptor.baseCollection || !descriptor.rootConfigPda || !descriptor.registryConfigPda) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation} without validated program configuration evidence`);
    }
    if (descriptor.inventoryEndSlot < descriptor.inventoryStartSlot || descriptor.sourceSlot !== descriptor.inventoryEndSlot) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation} with regressed inventory slots`);
    }
    if ((descriptor.proofCount ?? -1) !== indexedCount) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation}: Core proof count does not match indexed count`);
    }
  }
  if (directSolana8004 || metaplexCurrentState) {
    if ((descriptor.terminalRejectCount ?? -1) !== rejectedCount || indexedCount + rejectedCount !== discoveredCount) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation}: terminal accounting is incomplete`);
    }
    if (descriptor.reportedCount != null && discoveredCount !== descriptor.reportedCount) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation}: reported ${descriptor.reportedCount}, discovered ${discoveredCount}`);
    }
  } else {
    if (rejectedCount !== 0) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation} with ${rejectedCount} rejected records`);
    }
    if (indexedCount !== discoveredCount) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation}: indexed ${indexedCount} of ${discoveredCount}`);
    }
    if (descriptor.reportedCount != null && discoveredCount !== descriptor.reportedCount) {
      throw new Error(`cannot finalize ${descriptor.source} generation ${descriptor.generation}: reported ${descriptor.reportedCount}, discovered ${discoveredCount}`);
    }
  }
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await acquireSolanaSnapshotTransitionFence(tx);
    throwIfAborted(signal);
    const snapshot = await tx.solanaRegistrySnapshot.findUnique({
      where: {
        source_generation: {
          source: descriptor.source,
          generation: descriptor.generation,
        },
      },
      select: {
        status: true,
        registryAddress: true,
        sourceSlot: true,
        reportedCount: true,
        inventoryCount: true,
        inventoryDigest: true,
        proofCount: true,
        terminalRejectCount: true,
        rpcEndpointKey: true,
        genesisHash: true,
        programId: true,
        idlHash: true,
        configurationFingerprint: true,
        baseCollection: true,
        rootConfigPda: true,
        registryConfigPda: true,
        inventoryStartSlot: true,
        inventoryEndSlot: true,
        discoveredCount: true,
        indexedCount: true,
        rejectedCount: true,
      },
    });
    if (snapshot?.status !== "running") {
      throw new Error(`${descriptor.source} generation ${descriptor.generation} is not a running snapshot`);
    }
    if (
      snapshot.registryAddress !== descriptor.registryAddress ||
      snapshot.sourceSlot !== descriptor.sourceSlot ||
      snapshot.reportedCount !== descriptor.reportedCount ||
      snapshot.inventoryCount !== (descriptor.inventoryCount ?? null) ||
      snapshot.inventoryDigest !== (descriptor.inventoryDigest ?? null) ||
      snapshot.proofCount !== (descriptor.proofCount ?? 0) ||
      snapshot.terminalRejectCount !== (descriptor.terminalRejectCount ?? 0) ||
      snapshot.rpcEndpointKey !== (descriptor.rpcEndpointKey ?? null) ||
      snapshot.genesisHash !== (descriptor.genesisHash ?? null) ||
      snapshot.programId !== (descriptor.programId ?? null) ||
      snapshot.idlHash !== (descriptor.idlHash ?? null) ||
      snapshot.configurationFingerprint !== (descriptor.configurationFingerprint ?? null) ||
      snapshot.baseCollection !== (descriptor.baseCollection ?? null) ||
      snapshot.rootConfigPda !== (descriptor.rootConfigPda ?? null) ||
      snapshot.registryConfigPda !== (descriptor.registryConfigPda ?? null) ||
      snapshot.inventoryStartSlot !== (descriptor.inventoryStartSlot ?? null) ||
      snapshot.inventoryEndSlot !== (descriptor.inventoryEndSlot ?? null)
    ) {
      throw new Error(`${descriptor.source} generation ${descriptor.generation} descriptor changed before finalization`);
    }
    if (
      snapshot.discoveredCount !== discoveredCount ||
      snapshot.indexedCount !== indexedCount ||
      snapshot.rejectedCount !== rejectedCount
    ) {
      throw new Error(`${descriptor.source} generation ${descriptor.generation} progress was not checkpointed before finalization`);
    }
    let affectedAgentIds: number[] = [];
    if (!options.membershipInventoryUnchanged) {
      const staleMemberships = await tx.$queryRaw<Array<{ agentDbId: number }>>`
        WITH deactivated AS (
          UPDATE solana_registry_memberships
          SET
            is_current = FALSE,
            source_active = FALSE
          WHERE source = ${descriptor.source}
            AND is_current = TRUE
            AND last_seen_generation < ${descriptor.generation}
          RETURNING agent_db_id
        )
        SELECT DISTINCT agent_db_id AS "agentDbId"
        FROM deactivated
      `;
      affectedAgentIds = staleMemberships.map((row) => row.agentDbId);
      throwIfAborted(signal);
    }
    throwIfAborted(signal);
    await tx.solanaRegistrySnapshot.update({
      where: {
        source_generation: {
          source: descriptor.source,
          generation: descriptor.generation,
        },
      },
      data: {
        status: "complete",
        discoveredCount,
        indexedCount,
        rejectedCount,
        completedAt: new Date(),
        errorMessage: null,
      },
    });
    const sourceCursorKey = descriptor.source === SOLANA_REGISTRY_SOURCE.SOLANA_8004
      ? SOLANA_8004_IDENTITY_SOURCE_KEY
      : `solana:snapshot:${descriptor.source}`;
    await tx.indexerSourceCursor.upsert({
      where: { sourceKey: sourceCursorKey },
      create: {
        sourceKey: sourceCursorKey,
        chainId: SOLANA_CHAIN_ID,
        domain: "solana-current-agents",
        registryAddress: descriptor.registryAddress,
        slot: descriptor.sourceSlot,
        sourceHead: descriptor.sourceSlot,
        canonicalHead: descriptor.sourceSlot,
        finalityPolicy: "current-state-finalized",
        reconciliationGeneration: descriptor.generation,
        lastAdvancedAt: new Date(),
      },
      update: {
        registryAddress: descriptor.registryAddress,
        slot: descriptor.sourceSlot,
        sourceHead: descriptor.sourceSlot,
        canonicalHead: descriptor.sourceSlot,
        finalityPolicy: "current-state-finalized",
        reconciliationGeneration: descriptor.generation,
        lastAdvancedAt: new Date(),
      },
    });
    await refreshSolanaRegistryAgentLifecycles(tx, affectedAgentIds, { alreadyUnique: true });
    if (!options.membershipInventoryUnchanged) {
      const [current] = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT agent_db_id)::bigint AS count
        FROM solana_registry_memberships
        WHERE is_current = TRUE
      `;
      const currentAgentCount = Number(current?.count ?? 0n);
      if (!Number.isSafeInteger(currentAgentCount) || currentAgentCount > POSTGRES_SIGNED_INT_MAX) {
        throw new Error("Solana current agent count exceeds the PostgreSQL INTEGER domain");
      }
      await tx.chain.updateMany({
        where: { chainId: SOLANA_CHAIN_ID },
        data: { agentCount: currentAgentCount },
      });
    }
    throwIfAborted(signal);
  }, { isolationLevel: "Serializable", timeout: 120_000, maxWait: 30_000 }), 8);
}
