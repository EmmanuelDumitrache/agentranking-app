import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import {
  POSTGRES_SIGNED_BIGINT_MAX,
  POSTGRES_SIGNED_INT_MAX,
  type CurrentSolanaAgent,
  type SnapshotDescriptor,
} from "./solana-current-state-types";
import { refreshSolanaRegistryAgentLifecycle } from "./solana-registry-lifecycle";
import { throwIfAborted } from "../lib/abort";
import {
  acquireSolanaAgentIdentityLocks,
  acquireSolanaSnapshotWriterFence,
} from "./solana-agent-locks";
function rawJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === "bigint"
      ? item.toString(10)
      : typeof item === "string"
        ? item.replace(/\0/g, "")
        : item,
  )) as Prisma.InputJsonValue;
}

/** Advance an already-identical membership without rewriting its source evidence. */
export async function touchUnchangedMembershipSeen(
  tx: Prisma.TransactionClient,
  descriptor: SnapshotDescriptor,
  agentDbId: number,
  item: CurrentSolanaAgent,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  if (item.source !== descriptor.source || item.registryAddress !== descriptor.registryAddress) {
    throw new Error("membership touch does not match its snapshot descriptor");
  }
  if (descriptor.generation <= 0n || descriptor.generation > POSTGRES_SIGNED_BIGINT_MAX) {
    throw new Error("snapshot generation must fit a positive PostgreSQL BIGINT");
  }
  if (!Number.isSafeInteger(agentDbId) || agentDbId <= 0) {
    throw new Error("snapshot agent database ID is invalid");
  }
  const rawData = JSON.stringify(rawJson(item.raw));
  const evidencePredicate = item.sourceEvidenceKey == null
    ? Prisma.sql`(raw_data - 'sourceSlot') = (${rawData}::jsonb - 'sourceSlot')`
    : Prisma.sql`source_evidence_key = ${item.sourceEvidenceKey}`;
  const seenAt = new Date();
  const updated = await tx.$executeRaw(Prisma.sql`
    UPDATE solana_registry_memberships
    SET
      last_seen_generation = ${descriptor.generation},
      source_slot = ${item.sourceSlot ?? descriptor.sourceSlot},
      last_seen_at = ${seenAt}
    WHERE source = ${descriptor.source}
      AND external_id = ${item.externalId}
      AND registry_address = ${descriptor.registryAddress}
      AND agent_db_id = ${agentDbId}
      AND is_current = TRUE
      AND source_active IS NOT DISTINCT FROM ${item.sourceActive}
      AND source_updated_at IS NOT DISTINCT FROM ${item.sourceUpdatedAt}
      AND ${evidencePredicate}
      AND last_seen_generation < ${descriptor.generation}
  `);
  throwIfAborted(signal);
  return updated === 1;
}

export async function markMembershipSeen(
  tx: Prisma.TransactionClient,
  descriptor: SnapshotDescriptor,
  agentDbId: number,
  item: CurrentSolanaAgent,
  signal?: AbortSignal,
  options: {
    locksHeld?: boolean;
    currentLifecycleMaterialized?: boolean;
  } = {},
): Promise<void> {
  if (!descriptor.registryAddress.trim()) throw new Error("snapshot registry address is required");
  if (descriptor.generation <= 0n || descriptor.generation > POSTGRES_SIGNED_BIGINT_MAX) {
    throw new Error("snapshot generation must fit a positive PostgreSQL BIGINT");
  }
  if (descriptor.sourceSlot != null && (descriptor.sourceSlot < 0n || descriptor.sourceSlot > POSTGRES_SIGNED_BIGINT_MAX)) {
    throw new Error("snapshot source slot must fit a non-negative PostgreSQL BIGINT");
  }
  if (descriptor.reportedCount != null && (
    !Number.isSafeInteger(descriptor.reportedCount) ||
    descriptor.reportedCount < 0 ||
    descriptor.reportedCount > POSTGRES_SIGNED_INT_MAX
  )) {
    throw new Error("snapshot reported count must fit a non-negative PostgreSQL INTEGER");
  }
  if (item.source !== descriptor.source) {
    throw new Error(`snapshot item source ${item.source} does not match descriptor source ${descriptor.source}`);
  }
  if (item.registryAddress !== descriptor.registryAddress) {
    throw new Error(`snapshot item registry ${item.registryAddress} does not match descriptor registry ${descriptor.registryAddress}`);
  }
  if (!Number.isSafeInteger(agentDbId) || agentDbId <= 0) throw new Error("snapshot agent database ID is invalid");
  if (!item.externalId.trim() || !item.assetAddress.trim()) throw new Error("snapshot item identity is incomplete");
  if (item.externalId !== item.assetAddress) {
    throw new Error(`snapshot external ID ${item.externalId} does not match asset ${item.assetAddress}`);
  }
  if (item.sourceSlot != null && (item.sourceSlot < 0n || item.sourceSlot > POSTGRES_SIGNED_BIGINT_MAX)) {
    throw new Error("snapshot item source slot must fit a non-negative PostgreSQL BIGINT");
  }
  if (item.sourceUpdatedAt != null && Number.isNaN(item.sourceUpdatedAt.getTime())) {
    throw new Error("snapshot item source update time is invalid");
  }
  if (!options.locksHeld) {
    await acquireSolanaSnapshotWriterFence(tx);
    await acquireSolanaAgentIdentityLocks(tx, [`asset:${item.assetAddress}`]);
  }
  throwIfAborted(signal);
  const seenAt = new Date();
  const rawData = JSON.stringify(rawJson(item.raw));
  const [result] = await tx.$queryRaw<Array<{
    previousAgentDbId: number | null;
    previousGeneration: bigint | null;
    previousIsCurrent: boolean | null;
    previousSourceActive: boolean | null;
    written: boolean;
  }>>(Prisma.sql`
    WITH previous AS MATERIALIZED (
      SELECT agent_db_id, last_seen_generation, is_current, source_active
      FROM solana_registry_memberships
      WHERE source = ${descriptor.source}
        AND external_id = ${item.externalId}
    ), written AS (
      INSERT INTO solana_registry_memberships (
        id,
        source,
        external_id,
        registry_address,
        agent_db_id,
        is_current,
        source_active,
        last_seen_generation,
        source_slot,
        source_updated_at,
        source_evidence_key,
        raw_data,
        first_seen_at,
        last_seen_at
      ) VALUES (
        ${randomUUID()},
        ${descriptor.source},
        ${item.externalId},
        ${descriptor.registryAddress},
        ${agentDbId},
        TRUE,
        ${item.sourceActive},
        ${descriptor.generation},
        ${item.sourceSlot ?? descriptor.sourceSlot},
        ${item.sourceUpdatedAt},
        ${item.sourceEvidenceKey},
        ${rawData}::jsonb,
        ${seenAt},
        ${seenAt}
      )
      ON CONFLICT (source, external_id) DO UPDATE SET
        agent_db_id = EXCLUDED.agent_db_id,
        registry_address = EXCLUDED.registry_address,
        is_current = TRUE,
        source_active = EXCLUDED.source_active,
        last_seen_generation = EXCLUDED.last_seen_generation,
        source_slot = EXCLUDED.source_slot,
        source_updated_at = EXCLUDED.source_updated_at,
        source_evidence_key = EXCLUDED.source_evidence_key,
        raw_data = EXCLUDED.raw_data,
        last_seen_at = EXCLUDED.last_seen_at
      WHERE solana_registry_memberships.last_seen_generation < EXCLUDED.last_seen_generation
      RETURNING 1
    )
    SELECT
      (SELECT agent_db_id FROM previous) AS "previousAgentDbId",
      (SELECT last_seen_generation FROM previous) AS "previousGeneration",
      (SELECT is_current FROM previous) AS "previousIsCurrent",
      (SELECT source_active FROM previous) AS "previousSourceActive",
      EXISTS (SELECT 1 FROM written) AS written
  `);
  if (!result?.written) {
    const kind = result?.previousGeneration === descriptor.generation
      ? "duplicate"
      : "stale-generation";
    throw new Error(`${kind} ${descriptor.source} external ID ${item.externalId} in generation ${descriptor.generation}`);
  }
  const lifecycleChanged = result.previousAgentDbId !== agentDbId ||
    result.previousIsCurrent !== true ||
    result.previousSourceActive !== item.sourceActive;
  if (result.previousAgentDbId != null && result.previousAgentDbId !== agentDbId) {
    await refreshSolanaRegistryAgentLifecycle(tx, result.previousAgentDbId);
  }
  if (!options.currentLifecycleMaterialized && lifecycleChanged) {
    await refreshSolanaRegistryAgentLifecycle(tx, agentDbId);
  }
  throwIfAborted(signal);
}
