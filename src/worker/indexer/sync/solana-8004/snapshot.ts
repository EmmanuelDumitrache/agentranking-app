import { createHash } from "node:crypto";
import { forEachWithConcurrency } from "@/lib/async-pool";
import { indexerWorkerClaimConcurrency, prisma } from "../../db.js";
import { SOLANA_CHAIN_ID } from "../../chain-constants.js";
import { logger } from "../../logger.js";
import { throwIfAborted } from "../../lib/abort.js";
import { enqueueSolanaMetadataHydrationBatch } from "../../queue/producer.js";
import {
  SOLANA_REGISTRY_SOURCE,
  type CurrentSolanaAgent,
} from "../solana-current-state-types.js";
import { withSolanaSnapshotLock } from "../solana-snapshot-lock.js";
import {
  createSnapshot,
  failSnapshot,
  finalizeSnapshot,
  nextSnapshotGeneration,
  updateSnapshotProgress,
  type SnapshotDescriptor,
} from "../solana-snapshot-runner.js";
import { loadSolana8004Configuration } from "./configuration.js";
import {
  discoverSolana8004AgentAccounts,
  verifySolana8004AgentAccountInventory,
} from "./discover-agent-accounts.js";
import { hydrateSolana8004AgentAccounts } from "./hydrate-agent-accounts.js";
import { hydrateSolana8004CoreAssets } from "./hydrate-core-assets.js";
import {
  materializeSolana8004Agent,
  solana8004IdentityFingerprint,
} from "./materialize-agent.js";
import { normalizeSolana8004CurrentAgent } from "./normalize-current-agent.js";
import { loadSolana8004ProgramDefinition } from "./program.js";
import { selectSolana8004RpcEndpoint } from "./rpc-client.js";
import { normalizeRegistrationUri } from "../../lib/registration-document.js";
import {
  acquireSolanaAgentIdentityLocks,
  acquireSolanaSnapshotWriterFence,
} from "../solana-agent-locks.js";
import { withSerializableRetry } from "../../lib/serializable-retry.js";
export type Solana8004SnapshotResult = {
  generation: string;
  sourceSlot: string;
  inventoryCount: number;
  indexedCount: number;
  terminalRejectCount: number;
  inventoryDigest: string;
};
const UNCHANGED_TOUCH_BATCH_SIZE = 2_000;

function registrationMatchesMaterializedState(
  item: CurrentSolanaAgent,
  state: { registrationStatus: string | null; registrationNormalizedUri: string | null },
): boolean {
  if (!item.registrationUri) return state.registrationStatus === "missing_uri";
  try {
    const normalized = normalizeRegistrationUri(item.registrationUri);
    return state.registrationStatus === "available" &&
      state.registrationNormalizedUri === normalized.key;
  } catch {
    return false;
  }
}

async function selectChangedMaterializations(
  items: readonly CurrentSolanaAgent[],
  descriptor: SnapshotDescriptor,
  signal?: AbortSignal,
  options: { touchStable?: boolean } = {},
): Promise<CurrentSolanaAgent[]> {
  const changed: CurrentSolanaAgent[] = [];
  for (let offset = 0; offset < items.length; offset += UNCHANGED_TOUCH_BATCH_SIZE) {
    throwIfAborted(signal);
    const batch = items.slice(offset, offset + UNCHANGED_TOUCH_BATCH_SIZE);
    const touched = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      await acquireSolanaSnapshotWriterFence(tx);
      await acquireSolanaAgentIdentityLocks(
        tx,
        batch.map((item) => `asset:${item.assetAddress}`),
      );
      const memberships = await tx.solanaRegistryMembership.findMany({
        where: {
          source: descriptor.source,
          externalId: { in: batch.map((item) => item.externalId) },
        },
        select: {
          externalId: true,
          registryAddress: true,
          agentDbId: true,
          isCurrent: true,
          sourceActive: true,
          lastSeenGeneration: true,
          sourceUpdatedAt: true,
          sourceEvidenceKey: true,
        },
      });
      for (const membership of memberships) {
        if (membership.lastSeenGeneration >= descriptor.generation) {
          const kind = membership.lastSeenGeneration === descriptor.generation
            ? "duplicate"
            : "stale-generation";
          throw new Error(
            `${kind} ${descriptor.source} external ID ${membership.externalId} in generation ${descriptor.generation}`,
          );
        }
      }
      const agents = await tx.agent.findMany({
        where: { id: { in: memberships.map((membership) => membership.agentDbId) } },
        select: {
          id: true,
          chainId: true,
          sapAgentPda: true,
          sourceActive: true,
          sourceLifecycleStatus: true,
          sourceEvidenceType: true,
          sourceRegistryAddress: true,
          sourceFinality: true,
          chainIdentityFingerprint: true,
          registrationStatus: true,
          registrationNormalizedUri: true,
          solanaAssetAddress: true,
          solanaSequenceId: true,
          solanaCanonicalStatus: true,
          solanaCommitment: true,
          solanaOfficialRank: true,
          solanaAtomTrustTier: true,
          solanaIndexerUpdatedAt: true,
          solanaBlockTime: true,
        },
      });
      const membershipByExternalId = new Map(
        memberships.map((membership) => [membership.externalId, membership]),
      );
      const agentById = new Map(agents.map((agent) => [agent.id, agent]));
      const stable: CurrentSolanaAgent[] = [];
      for (const item of batch) {
        const membership = membershipByExternalId.get(item.externalId);
        const agent = membership ? agentById.get(membership.agentDbId) : null;
        if (!membership || !agent) continue;
        const expectedIdentity = solana8004IdentityFingerprint({
          asset: item.assetAddress,
          sequenceId: item.sequenceId,
          owner: item.owner,
          creator: item.creator,
          wallet: item.operationalWallet,
          uri: item.registrationUri,
        });
        if (
          membership.registryAddress !== descriptor.registryAddress ||
          !membership.isCurrent ||
          membership.sourceActive !== item.sourceActive ||
          membership.sourceUpdatedAt?.getTime() !== item.sourceUpdatedAt?.getTime() ||
          membership.sourceEvidenceKey !== item.sourceEvidenceKey ||
          agent.chainId !== SOLANA_CHAIN_ID ||
          Boolean(agent.sapAgentPda?.trim()) ||
          agent.sourceActive !== true ||
          agent.sourceLifecycleStatus !== "current" ||
          agent.sourceEvidenceType !== "solana-8004-direct-rpc" ||
          agent.sourceRegistryAddress !== descriptor.registryAddress ||
          agent.sourceFinality !== "rpc-finalized-stable-inventory" ||
          agent.chainIdentityFingerprint !== expectedIdentity ||
          agent.solanaAssetAddress !== item.assetAddress ||
          agent.solanaSequenceId !== item.sequenceId ||
          agent.solanaCanonicalStatus !== "FINALIZED" ||
          agent.solanaCommitment !== "finalized" ||
          agent.solanaOfficialRank != null ||
          agent.solanaAtomTrustTier != null ||
          agent.solanaIndexerUpdatedAt != null ||
          agent.solanaBlockTime != null ||
          !registrationMatchesMaterializedState(item, agent)
        ) continue;
        stable.push(item);
      }
      if (stable.length === 0) return [];
      const stableExternalIds = stable.map((item) => item.externalId);
      if (options.touchStable === false) return stableExternalIds;
      const seenAt = new Date();
      const membershipUpdate = await tx.solanaRegistryMembership.updateMany({
        where: {
          source: descriptor.source,
          externalId: { in: stableExternalIds },
          isCurrent: true,
          lastSeenGeneration: { lt: descriptor.generation },
        },
        data: {
          lastSeenGeneration: descriptor.generation,
          sourceSlot: descriptor.sourceSlot,
          lastSeenAt: seenAt,
        },
      });
      if (membershipUpdate.count !== stable.length) {
        throw new Error(`unchanged membership batch lost its generation fence`);
      }
      return stableExternalIds;
    }, { isolationLevel: "ReadCommitted", timeout: 120_000, maxWait: 30_000 }), 8);
    const touchedSet = new Set(touched);
    for (const item of batch) {
      if (!touchedSet.has(item.externalId)) changed.push(item);
    }
  }
  return changed;
}
function finalInventoryDigest(
  programId: string,
  genesisHash: string,
  accountPdas: readonly string[],
  assetByAccountPda: ReadonlyMap<string, string>,
): string {
  // Callers provide rows in the already-sorted authoritative account-inventory
  // order. Stream the digest to avoid another O(n log n) sort and a second
  // inventory-sized joined string.
  const hash = createHash("sha256").update(programId).update("\0").update(genesisHash).update("\0");
  for (let index = 0; index < accountPdas.length; index += 1) {
    if (index > 0) hash.update("\n");
    const accountPda = accountPdas[index]!;
    hash.update(accountPda).update(":").update(
      assetByAccountPda.get(accountPda) ?? "!terminal-reject",
    );
  }
  return hash.digest("hex");
}
export async function runDirectSolana8004Snapshot(
  signal?: AbortSignal,
): Promise<Solana8004SnapshotResult> {
  return withSolanaSnapshotLock(
    "solana-8004",
    signal,
    async (operationSignal) => {
      const program = loadSolana8004ProgramDefinition();
      const endpoint = await selectSolana8004RpcEndpoint(program, operationSignal);
      const configuration = await loadSolana8004Configuration({
        endpoint,
        program,
        signal: operationSignal,
      });
      const inventoryA = await discoverSolana8004AgentAccounts({
        endpoint,
        programId: program.programId,
        minContextSlot: configuration.contextSlot,
        signal: operationSignal,
      });
      const generation = await nextSnapshotGeneration(SOLANA_REGISTRY_SOURCE.SOLANA_8004);
      const descriptor: SnapshotDescriptor = {
        source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
        registryAddress: program.programId,
        generation,
        sourceSlot: inventoryA.slot,
        reportedCount: null,
        inventoryCount: inventoryA.accountPdas.length,
        inventoryDigest: null,
        proofCount: 0,
        terminalRejectCount: 0,
        rpcEndpointKey: endpoint.endpointKey,
        genesisHash: endpoint.genesisHash,
        programId: program.programId,
        idlHash: program.idlHash,
        configurationFingerprint: configuration.configurationFingerprint,
        baseCollection: configuration.baseCollection,
        rootConfigPda: configuration.rootConfigPda,
        registryConfigPda: configuration.registryConfigPda,
        inventoryStartSlot: inventoryA.slot,
        inventoryEndSlot: null,
      };
      await createSnapshot(descriptor);
      try {
        const hydrated = await hydrateSolana8004AgentAccounts({
          endpoint,
          programId: program.programId,
          accountPdas: inventoryA.accountPdas,
          expectedCollection: configuration.baseCollection,
          minContextSlot: inventoryA.slot,
          signal: operationSignal,
        });
        const inventoryB = await verifySolana8004AgentAccountInventory({
          endpoint,
          programId: program.programId,
          expectedAccountPdas: inventoryA.accountPdas,
          minContextSlot: inventoryA.slot,
          signal: operationSignal,
        });
        const assetByAccountPda = new Map(
          hydrated.accounts.map((row) => [row.accountPda, row.decoded.asset]),
        );
        const normalizedInventory: CurrentSolanaAgent[] = [];
        let proofCount = 0;
        let terminalRejectCount = hydrated.terminalRejectCount;
        // Core deserialization objects are substantially larger than the four
        // source fields retained by the normalized projection. Hydrate one page,
        // normalize it, and release both the proof and decoded account objects
        // before moving on instead of holding two 100k-object inventories.
        for (let offset = 0; offset < hydrated.accounts.length; offset += UNCHANGED_TOUCH_BATCH_SIZE) {
          throwIfAborted(operationSignal);
          const sourceBatch = hydrated.accounts.slice(offset, offset + UNCHANGED_TOUCH_BATCH_SIZE);
          const coreBatch = await hydrateSolana8004CoreAssets({
            endpoint,
            assetAddresses: sourceBatch.map((row) => row.decoded.asset),
            minContextSlot: inventoryA.slot,
            signal: operationSignal,
          });
          if (coreBatch.proofs.size + coreBatch.terminalRejectCount !== sourceBatch.length) {
            throw new Error("Core proof hydration returned incomplete terminal accounting");
          }
          proofCount += coreBatch.proofs.size;
          terminalRejectCount += coreBatch.terminalRejectCount;
          for (let index = 0; index < sourceBatch.length; index += 1) {
            const row = sourceBatch[index]!;
            const coreAsset = coreBatch.proofs.get(row.decoded.asset);
            if (coreAsset) {
              normalizedInventory.push(normalizeSolana8004CurrentAgent({
                account: row,
                coreAsset,
                registryAddress: program.programId,
                sourceSlot: inventoryB.slot,
              }));
            } else {
              // Include Core proof failures in the inventory evidence. This
              // makes the unchanged-inventory fast path sensitive to a record
              // moving between materializable and terminal-reject states.
              assetByAccountPda.delete(row.accountPda);
            }
            hydrated.accounts[offset + index] = undefined as never;
          }
        }
        hydrated.accounts.length = 0;
        const inventoryDigest = finalInventoryDigest(
          program.programId,
          endpoint.genesisHash,
          inventoryA.accountPdas,
          assetByAccountPda,
        );
        assetByAccountPda.clear();
        const completeDescriptor: SnapshotDescriptor = {
          ...descriptor,
          sourceSlot: inventoryB.slot,
          inventoryDigest,
          proofCount,
          terminalRejectCount,
          inventoryEndSlot: inventoryB.slot,
        };
        const latestPriorSnapshot = await prisma.solanaRegistrySnapshot.findFirst({
          where: {
            source: descriptor.source,
            generation: { lt: generation },
          },
          orderBy: { generation: "desc" },
          select: {
            status: true,
            registryAddress: true,
            inventoryDigest: true,
            proofCount: true,
            terminalRejectCount: true,
            configurationFingerprint: true,
          },
        });
        // Only the immediately preceding generation is eligible. A failed run
        // may have partially touched memberships, so looking past it to an older
        // complete snapshot would incorrectly skip reconciliation.
        const membershipInventoryUnchanged =
          latestPriorSnapshot?.status === "complete" &&
          latestPriorSnapshot.registryAddress === descriptor.registryAddress &&
          latestPriorSnapshot.inventoryDigest === inventoryDigest &&
          latestPriorSnapshot.proofCount === proofCount &&
          latestPriorSnapshot.terminalRejectCount === terminalRejectCount &&
          latestPriorSnapshot.configurationFingerprint === descriptor.configurationFingerprint;
        throwIfAborted(operationSignal);
        const evidenceUpdate = await prisma.solanaRegistrySnapshot.updateMany({
          where: {
            source: descriptor.source,
            generation,
            status: "running",
            registryAddress: descriptor.registryAddress,
            sourceSlot: inventoryA.slot,
            inventoryStartSlot: inventoryA.slot,
          },
          data: {
            sourceSlot: inventoryB.slot,
            inventoryDigest,
            proofCount,
            terminalRejectCount,
            inventoryEndSlot: inventoryB.slot,
          },
        });
        if (evidenceUpdate.count !== 1) {
          throw new Error(`Solana 8004 generation ${generation} is no longer the running snapshot`);
        }
        const indexedCount = normalizedInventory.length;
        // Consume the normalized projection a page at a time. When the exact
        // authoritative inventory matches the immediately preceding successful
        // generation, stable memberships need neither a generation rewrite nor
        // a global disappearance/count reconciliation.
        for (let offset = 0; offset < normalizedInventory.length; offset += UNCHANGED_TOUCH_BATCH_SIZE) {
          throwIfAborted(operationSignal);
          const normalizedBatch = normalizedInventory.slice(offset, offset + UNCHANGED_TOUCH_BATCH_SIZE);
          const changedBatch = await selectChangedMaterializations(
            normalizedBatch,
            completeDescriptor,
            operationSignal,
            { touchStable: !membershipInventoryUnchanged },
          );
          // Changed Agent transactions are independent and already protected by
          // the canonical per-Agent advisory fence. The async pool drains
          // in-flight work before propagating failure, so the source lock is never
          // released while sibling materializations can still commit.
          const metadataHydrations: Array<{ asset: string; uri: string }> = [];
          await forEachWithConcurrency(
            changedBatch,
            indexerWorkerClaimConcurrency,
            async (normalized) => {
              throwIfAborted(operationSignal);
              const result = await materializeSolana8004Agent({
                raw: normalized.raw,
                asset: normalized.assetAddress,
                sequenceId: normalized.sequenceId,
                owner: normalized.owner,
                creator: normalized.creator,
                wallet: normalized.operationalWallet,
                uri: normalized.registrationUri,
                status: "FINALIZED",
                source: {
                  slot: inventoryB.slot,
                  blockTime: null,
                  indexerUpdatedAt: null,
                },
                officialRank: null,
                trustTier: null,
                signal: operationSignal,
                // Registration hydration is deferred to the bootstrap metadata
                // phase. Identity visibility never depends on HTTP/IPFS success.
                snapshotDescriptor: completeDescriptor,
                snapshotItem: normalized,
              });
              if (result.metadataHydration) metadataHydrations.push(result.metadataHydration);
            },
          );
          if (metadataHydrations.length > 0) {
            await enqueueSolanaMetadataHydrationBatch(metadataHydrations).catch((error) => {
              logger.warn("failed to enqueue Solana metadata hydration batch", {
                count: metadataHydrations.length,
                error: error instanceof Error ? error.message : String(error),
              }, "queue");
            });
          }
          for (let index = 0; index < normalizedBatch.length; index += 1) {
            normalizedInventory[offset + index] = undefined as never;
          }
        }
        normalizedInventory.length = 0;
        await updateSnapshotProgress({
          descriptor: completeDescriptor,
          discoveredCount: inventoryA.accountPdas.length,
          indexedCount,
          rejectedCount: terminalRejectCount,
        });
        await finalizeSnapshot(
          completeDescriptor,
          inventoryA.accountPdas.length,
          indexedCount,
          terminalRejectCount,
          operationSignal,
          { membershipInventoryUnchanged },
        );
        return {
          generation: generation.toString(10),
          sourceSlot: inventoryB.slot.toString(10),
          inventoryCount: inventoryA.accountPdas.length,
          indexedCount,
          terminalRejectCount,
          inventoryDigest,
        };
      } catch (error) {
        try {
          await failSnapshot(
            SOLANA_REGISTRY_SOURCE.SOLANA_8004,
            generation,
            error instanceof Error ? error.message : String(error),
          );
        } catch (persistError) {
          throw new AggregateError(
            [error, persistError],
            "Solana 8004 snapshot and failure-state persistence both failed",
          );
        }
        throw error;
      }
    },
  );
}
