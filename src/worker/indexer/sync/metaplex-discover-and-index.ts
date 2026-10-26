import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { forEachWithConcurrency } from "@/lib/async-pool";
import {
  discoverAllMetaplexIdentityAssets,
  MPL_AGENT_IDENTITY_PROGRAM_ID,
} from "@/lib/metaplex/discover-on-chain";
import {
  fetchDasAssetBatch,
  type DasAssetResult,
} from "@/lib/metaplex/das-client";
import { hydrateCoreAssetsRpc } from "@/lib/metaplex/core-rpc-hydration";
import type {
  MetaplexDiscoverAndIndexResult,
  MetaplexBulkIndexResultItem,
} from "@/lib/metaplex/types";
import { prisma } from "@/lib/db";
import type {
  RegistrationDocumentFetchStatus,
} from "@/lib/registration-document";
import type { RegistrationJson } from "./agent-metadata.js";
import { indexMetaplexAgent } from "../../../../services/metaplex-indexer";
import {
  createSnapshot,
  failSnapshot,
  finalizeSnapshot,
  nextSnapshotGeneration,
  updateSnapshotProgress,
  type SnapshotDescriptor,
} from "./solana-snapshot-runner.js";
import {
  SOLANA_REGISTRY_SOURCE,
} from "./solana-current-state-types.js";
import { throwIfAborted } from "../lib/abort.js";
import { withSolanaSnapshotLock } from "./solana-snapshot-lock.js";
import { indexerWorkerClaimConcurrency } from "../db.js";
import { logger } from "../logger.js";
export const METAPLEX_DISCOVER_DEFAULT_BATCH = 50;
export const METAPLEX_DISCOVER_MAX_BATCH = 200;
const METAPLEX_PRIOR_STATE_BATCH = 5_000;
const METAPLEX_PROCESS_PAGE_SIZE = 2_000;
const METAPLEX_RESULT_SAMPLE_LIMIT = 100;
const METAPLEX_REGISTRATION_REFRESH_SHARDS = 4n;
type MetaplexPriorState = {
  agentDbId: number;
  syncFingerprint: string | null;
  hasCurrentSolana8004Membership: boolean;
  registrationUri: string | null;
  registrationJson: RegistrationJson | null;
  registrationStatus: RegistrationDocumentFetchStatus | null;
  registrationErrorClass: string | null;
  registrationErrorMessage: string | null;
  registrationNextRetryAt: Date | null;
};
type MetaplexPriorStateRow = {
  externalId: string;
  agentDbId: number;
  lastSeenGeneration: bigint;
  syncFingerprint: string | null;
  hasCurrentSolana8004Membership: boolean;
  registrationUri: string | null;
  registrationJson: Prisma.JsonValue | null;
  registrationStatus: string | null;
  registrationErrorClass: string | null;
  registrationErrorMessage: string | null;
  registrationNextRetryAt: string | null;
};

function storedRegistrationJson(value: Prisma.JsonValue | null): RegistrationJson | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RegistrationJson
    : null;
}

function storedRegistrationStatus(value: string | null): RegistrationDocumentFetchStatus | null {
  return value === "available" ||
      value === "transient_unavailable" ||
      value === "permanent_invalid" ||
      value === "missing_uri"
    ? value
    : null;
}

function storedRetryAt(value: string | null): Date | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function metaplexRegistrationRefreshDue(assetAddress: string, generation: bigint): boolean {
  // Refresh sharding needs stable distribution, not a cryptographic digest.
  // FNV-1a avoids constructing and finalizing 100k SHA-256 objects per snapshot.
  let hash = 2_166_136_261;
  for (let index = 0; index < assetAddress.length; index += 1) {
    hash ^= assetAddress.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const shard = BigInt(hash >>> 0) % METAPLEX_REGISTRATION_REFRESH_SHARDS;
  return shard === generation % METAPLEX_REGISTRATION_REFRESH_SHARDS;
}

async function loadMetaplexPriorState(
  assetAddresses: readonly string[],
  descriptor: SnapshotDescriptor,
  signal?: AbortSignal,
): Promise<Map<string, MetaplexPriorState>> {
  const state = new Map<string, MetaplexPriorState>();
  if (new Set(assetAddresses).size !== assetAddresses.length) {
    throw new Error(
      `duplicate ${descriptor.source} external ID in generation ${descriptor.generation}`,
    );
  }
  for (let offset = 0; offset < assetAddresses.length; offset += METAPLEX_PRIOR_STATE_BATCH) {
    throwIfAborted(signal);
    const addressBatch = assetAddresses.slice(
      offset,
      offset + METAPLEX_PRIOR_STATE_BATCH,
    );
    // Select only the cached registration subtree instead of transferring the
    // entire raw Core/DAS evidence JSON for every existing agent. The lateral
    // fingerprint and EXISTS probe also collapse Prisma's nested relation loads
    // into one bounded query per page.
    const rows = await prisma.$queryRaw<MetaplexPriorStateRow[]>(Prisma.sql`
      SELECT
        membership.external_id AS "externalId",
        membership.agent_db_id AS "agentDbId",
        membership.last_seen_generation AS "lastSeenGeneration",
        fingerprint.value AS "syncFingerprint",
        EXISTS (
          SELECT 1
          FROM solana_registry_memberships AS canonical_membership
          WHERE canonical_membership.agent_db_id = membership.agent_db_id
            AND canonical_membership.source = ${SOLANA_REGISTRY_SOURCE.SOLANA_8004}
            AND canonical_membership.is_current = TRUE
        ) AS "hasCurrentSolana8004Membership",
        agent.metaplex_agent_registration_uri AS "registrationUri",
        agent.metaplex_raw_data -> 'registrationJson' AS "registrationJson",
        agent.registration_status AS "registrationStatus",
        agent.registration_error_class AS "registrationErrorClass",
        agent.registration_error_message AS "registrationErrorMessage",
        agent.registration_next_retry_at AS "registrationNextRetryAt"
      FROM solana_registry_memberships AS membership
      JOIN "Agent" AS agent ON agent.id = membership.agent_db_id
      LEFT JOIN LATERAL (
        SELECT metadata.value
        FROM "AgentMetadata" AS metadata
        WHERE metadata."agentId" = membership.agent_db_id
          AND metadata.key = 'syncFingerprint:metaplex'
          AND metadata.source_kind = 'metaplex-registration'
        ORDER BY metadata.id
        LIMIT 1
      ) AS fingerprint ON TRUE
      WHERE membership.source = ${SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY}
        AND membership.external_id IN (${Prisma.join(addressBatch)})
    `);
    for (const row of rows) {
      if (row.lastSeenGeneration >= descriptor.generation) {
        const kind = row.lastSeenGeneration === descriptor.generation
          ? "duplicate"
          : "stale-generation";
        throw new Error(
          `${kind} ${descriptor.source} external ID ${row.externalId} in generation ${descriptor.generation}`,
        );
      }
      state.set(row.externalId, {
        agentDbId: row.agentDbId,
        syncFingerprint: row.syncFingerprint,
        hasCurrentSolana8004Membership: row.hasCurrentSolana8004Membership,
        registrationUri: row.registrationUri,
        registrationJson: storedRegistrationJson(row.registrationJson),
        registrationStatus: storedRegistrationStatus(row.registrationStatus),
        registrationErrorClass: row.registrationErrorClass,
        registrationErrorMessage: row.registrationErrorMessage,
        registrationNextRetryAt: storedRetryAt(row.registrationNextRetryAt),
      });
    }
  }
  return state;
}
export function clampMetaplexDiscoverBatch(limit: number | undefined): number {
  const n = limit ?? METAPLEX_DISCOVER_DEFAULT_BATCH;
  if (!Number.isFinite(n) || n <= 0) return METAPLEX_DISCOVER_DEFAULT_BATCH;
  return Math.min(Math.floor(n), METAPLEX_DISCOVER_MAX_BATCH);
}
async function discoverAndIndexMetaplexAgentsUnlocked(options?: {
  limit?: number | null;
  dryRun?: boolean;
  signal?: AbortSignal;
}): Promise<MetaplexDiscoverAndIndexResult> {
  const dryRun = options?.dryRun === true;
  const signal = options?.signal;
  throwIfAborted(signal);
  const discovery = await discoverAllMetaplexIdentityAssets(signal);
  throwIfAborted(signal);
  // Discovery has already validated every identity PDA and derives every asset
  // address from an exact 32-byte account field. Avoid decoding both base58
  // addresses a second time for the full inventory.
  const items = discovery.items;
  const uniqueAssetAddresses = new Set<string>();
  for (const item of items) {
    if (uniqueAssetAddresses.has(item.assetAddress)) {
      throw new Error(`duplicate Metaplex identity asset ${item.assetAddress}`);
    }
    uniqueAssetAddresses.add(item.assetAddress);
  }
  uniqueAssetAddresses.clear();
  const invalidCount = 0;
  const requestedLimit = options?.limit == null ? items.length : Math.max(0, Math.floor(options.limit));
  const toProcess = requestedLimit >= items.length ? items : items.slice(0, requestedLimit);
  const latestCompleteSnapshot = await prisma.solanaRegistrySnapshot.findFirst({
    where: {
      source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
      status: "complete",
    },
    orderBy: { generation: "desc" },
    select: { indexedCount: true },
  });
  const summary = {
    onChainTotal: items.length,
    // A completed snapshot is the authoritative membership projection. Avoid
    // recounting the entire current membership set before every new snapshot.
    dbIndexed: latestCompleteSnapshot?.indexedCount ?? await prisma.solanaRegistryMembership.count({
      where: { source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY, isCurrent: true },
    }),
    missingOnChain: 0,
    batchSize: toProcess.length,
    dryRun,
  };
  if (dryRun) {
    return {
      ok: invalidCount === 0,
      ...summary,
      attempted: 0,
      indexed: 0,
      existing: 0,
      failed: invalidCount,
      message: "Dry run — complete current Metaplex identity inventory",
      sample: toProcess.slice(0, 10).map((item) => item.assetAddress),
      resultsTruncated: toProcess.length > METAPLEX_RESULT_SAMPLE_LIMIT,
      results: toProcess.slice(0, METAPLEX_RESULT_SAMPLE_LIMIT).map((item) => ({
        assetAddress: item.assetAddress,
        ok: true,
      })),
    };
  }
  if (toProcess.length !== items.length) {
    return {
      ok: false,
      ...summary,
      attempted: 0,
      indexed: 0,
      existing: 0,
      failed: items.length - toProcess.length + invalidCount,
      message: "Partial Metaplex scans are not authoritative and were not started",
      results: [],
    };
  }
  // The source-scoped distributed lock proves no other Metaplex snapshot writer
  // is active. A pre-existing running row for this exact source therefore belongs
  // to an interrupted process and cannot be resumed safely as a non-paginated scan.
  const orphanRunning = await prisma.solanaRegistrySnapshot.findFirst({
    where: { source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY, status: "running" },
    orderBy: { generation: "desc" },
    select: { generation: true },
  });
  if (orphanRunning) {
    await failSnapshot(
      SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
      orphanRunning.generation,
      "Metaplex snapshot was interrupted before completion",
    );
    logger.warn(
      "recovered orphaned Metaplex snapshot",
      { generation: orphanRunning.generation.toString(10) },
      "sync",
    );
  }
  const cursor = await prisma.indexerSourceCursor.findUnique({
    where: { sourceKey: `solana:snapshot:${SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY}` },
    select: { reconciliationGeneration: true },
  });
  const generation = await nextSnapshotGeneration(
    SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
    cursor?.reconciliationGeneration ?? 0n,
  );
  const descriptor: SnapshotDescriptor = {
    source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
    registryAddress: MPL_AGENT_IDENTITY_PROGRAM_ID,
    generation,
    sourceSlot: discovery.coverageSlot,
    reportedCount: items.length,
  };
  await createSnapshot(descriptor);
  try {
    // Every discovered identity must prove the current Core account through
    // ordinary finalized RPC. DAS is parsed enrichment only, never inventory or
    // Core-account evidence. Deterministic missing, owner, and decode failures are
    // terminally accounted; transport-level batch failures abort the snapshot.
    const hydrationMinSlot = discovery.v1ContextSlot > discovery.v2ContextSlot
      ? discovery.v1ContextSlot
      : discovery.v2ContextSlot;
    // Keep the source work-conserving without introducing a Metaplex-specific
    // process cap. PostgreSQL pool capacity is the actual shared write resource;
    // Solana RPC calls are independently constrained by their physical endpoint lanes.
    const concurrency = indexerWorkerClaimConcurrency;
    let indexed = 0;
    let existing = 0;
    let terminalRejected = 0;
    let transientFailed = 0;
    const membershipInventoryHash = createHash("sha256")
      .update(MPL_AGENT_IDENTITY_PROGRAM_ID)
      .update("\0");
    const results: MetaplexBulkIndexResultItem[] = [];
    const retainResult = (result: MetaplexBulkIndexResultItem): void => {
      if (results.length < METAPLEX_RESULT_SAMPLE_LIMIT) results.push(result);
    };
    for (let offset = 0; offset < items.length; offset += METAPLEX_PROCESS_PAGE_SIZE) {
      throwIfAborted(signal);
      const itemBatch = items.slice(offset, offset + METAPLEX_PROCESS_PAGE_SIZE);
      const batchAddresses = itemBatch.map((identity) => identity.assetAddress);
      // DAS enrichment, finalized Core proof, and prior projection state are
      // independent page inputs. Loading them together removes two full network/
      // database latency legs per page while their own resource schedulers keep
      // provider concurrency bounded.
      const [dasAssets, hydratedCore, priorState] = await Promise.all([
        fetchDasAssetBatch(batchAddresses, signal).catch((error) => {
          if (signal?.aborted) throw error;
          return new Map<string, DasAssetResult>();
        }),
        hydrateCoreAssetsRpc(batchAddresses, hydrationMinSlot, signal),
        loadMetaplexPriorState(batchAddresses, descriptor, signal),
      ]);
      const rpcAssets = hydratedCore.assets;
      const terminalCoreRejects = hydratedCore.terminalRejects;
      const pageAgentIds = new Map<string, number>();
      await forEachWithConcurrency(itemBatch, concurrency, async (identity) => {
        try {
          const terminalReason = terminalCoreRejects.get(identity.assetAddress);
          if (terminalReason) {
            terminalRejected += 1;
            retainResult({
              assetAddress: identity.assetAddress,
              ok: false,
              terminal: true,
              error: terminalReason,
            });
            return;
          }
          try {
            throwIfAborted(signal);
            const dasAsset = dasAssets.get(identity.assetAddress);
            const decodedCoreAsset = rpcAssets.get(identity.assetAddress);
            if (!decodedCoreAsset) throw new Error(`Finalized Core proof missing for ${identity.assetAddress}`);
            const prior = priorState.get(identity.assetAddress);
            const result = await indexMetaplexAgent(identity.assetAddress, {
              snapshotLockHeld: true,
              snapshotDescriptor: descriptor,
              identityPda: identity.identityPda,
              identityVersion: identity.identityVersion,
              sourceSlot: identity.sourceSlot,
              dasAsset,
              decodedCoreAsset,
              priorAgentDbId: prior?.agentDbId,
              priorSyncFingerprint: prior?.syncFingerprint,
              priorHasCurrentSolana8004Membership:
                prior?.hasCurrentSolana8004Membership,
              priorRegistrationUri: prior?.registrationUri,
              priorRegistrationJson: prior?.registrationJson,
              priorRegistrationStatus: prior?.registrationStatus,
              priorRegistrationErrorClass: prior?.registrationErrorClass,
              priorRegistrationErrorMessage: prior?.registrationErrorMessage,
              priorRegistrationNextRetryAt: prior?.registrationNextRetryAt,
              refreshRegistrationDocument:
                prior == null || metaplexRegistrationRefreshDue(
                  identity.assetAddress,
                  descriptor.generation,
                ),
              signal,
            });
            throwIfAborted(signal);
            if (!result.ok || result.agentDbId == null) throw new Error(result.error ?? "Metaplex indexing did not return an agent ID");
            if (result.created) indexed += 1;
            else existing += 1;
            pageAgentIds.set(identity.assetAddress, result.agentDbId);
            retainResult({
              assetAddress: identity.assetAddress,
              ok: true,
              created: result.created,
              agentDbId: result.agentDbId,
              profilePath: result.profilePath,
              profileUrl: result.profileUrl,
            });
          } catch (error) {
            if (signal?.aborted) throw error;
            transientFailed += 1;
            retainResult({
              assetAddress: identity.assetAddress,
              ok: false,
              terminal: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          dasAssets.delete(identity.assetAddress);
          rpcAssets.delete(identity.assetAddress);
          priorState.delete(identity.assetAddress);
        }
      });
      // Stream the authoritative external-ID → canonical-Agent mapping in
      // discovery order. Including the attachment means a same-sized inventory
      // that was re-parented still performs lifecycle and global-count repair.
      for (const identity of itemBatch) {
        const agentDbId = pageAgentIds.get(identity.assetAddress);
        membershipInventoryHash
          .update(identity.assetAddress)
          .update(terminalCoreRejects.has(identity.assetAddress)
            ? ":reject\n"
            : `:${agentDbId ?? "failed"}\n`);
      }
    }
    const attempted = items.length;
    const succeeded = indexed + existing;
    const resultsTruncated = results.length < attempted;
    const inventoryDigest = membershipInventoryHash.digest("hex");
    const completeDescriptor: SnapshotDescriptor = {
      ...descriptor,
      inventoryDigest,
      proofCount: succeeded,
      terminalRejectCount: terminalRejected,
    };
    const latestPriorSnapshot = await prisma.solanaRegistrySnapshot.findFirst({
      where: {
        source: descriptor.source,
        generation: { lt: descriptor.generation },
      },
      orderBy: { generation: "desc" },
      select: {
        status: true,
        registryAddress: true,
        inventoryDigest: true,
        proofCount: true,
        terminalRejectCount: true,
      },
    });
    const membershipInventoryUnchanged =
      latestPriorSnapshot?.status === "complete" &&
      latestPriorSnapshot.registryAddress === descriptor.registryAddress &&
      latestPriorSnapshot.inventoryDigest === inventoryDigest &&
      latestPriorSnapshot.proofCount === succeeded &&
      latestPriorSnapshot.terminalRejectCount === terminalRejected;
    await updateSnapshotProgress({
      descriptor: completeDescriptor,
      discoveredCount: items.length,
      indexedCount: succeeded,
      rejectedCount: terminalRejected + transientFailed,
    });
    if (transientFailed > 0 || succeeded + terminalRejected !== items.length) {
      await failSnapshot(
        descriptor.source,
        descriptor.generation,
        `Metaplex snapshot had ${transientFailed} transient failures and ${terminalRejected} terminal rejects`,
      );
      return {
        ok: false,
        ...summary,
        attempted,
        indexed,
        existing,
        failed: terminalRejected + transientFailed,
        resultsTruncated,
        message: "Metaplex snapshot failed; prior completed membership remains authoritative",
        results,
      };
    }
    throwIfAborted(signal);
    await finalizeSnapshot(
      completeDescriptor,
      items.length,
      succeeded,
      terminalRejected,
      signal,
      { membershipInventoryUnchanged },
    );
    return {
      ok: true,
      ...summary,
      attempted,
      indexed,
      existing,
      failed: terminalRejected,
      dbActiveMetaplexCount: succeeded,
      resultsTruncated,
      message: terminalRejected > 0
        ? `Metaplex current-state snapshot complete with ${terminalRejected} terminal rejects`
        : "Metaplex current-state snapshot complete",
      results,
    };
  } catch (error) {
    try {
      await failSnapshot(
        descriptor.source,
        descriptor.generation,
        error instanceof Error ? error.message : String(error),
      );
    } catch (persistError) {
      throw new AggregateError(
        [error, persistError],
        "Metaplex snapshot and failure-state persistence both failed",
      );
    }
    throw error;
  }
}
export async function discoverAndIndexMetaplexAgents(options?: {
  limit?: number | null;
  dryRun?: boolean;
  signal?: AbortSignal;
}): Promise<MetaplexDiscoverAndIndexResult> {
  if (options?.dryRun === true) return discoverAndIndexMetaplexAgentsUnlocked(options);
  return withSolanaSnapshotLock("metaplex-agent-registry", options?.signal, (lockedSignal) =>
    discoverAndIndexMetaplexAgentsUnlocked({ ...options, signal: lockedSignal }),
  );
}
