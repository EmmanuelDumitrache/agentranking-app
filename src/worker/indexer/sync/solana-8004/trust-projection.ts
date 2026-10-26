import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../../db.js";
import { withDatabaseConcurrencyRetry } from "../../lib/serializable-retry.js";
import { adjustChainFeedbackCounts } from "../chain-feedback-counts.js";
import { SOLANA_REGISTRY_SOURCE } from "../solana-current-state-types.js";
import { acquireSolanaAgentIdentityLocks, acquireSolanaSnapshotWriterFence } from "../solana-agent-locks.js";
import type { DecodedSolana8004TrustEvent, Solana8004TrustIntegrity, Solana8004TrustStatus } from "./trust-types.js";
import { SOLANA_8004_TRUST_DECODER_VERSION } from "./trust-types.js";
const POSTGRES_INT_MAX = 2_147_483_647n;
const UNLINKED_RECONCILIATION_BATCH_SIZE = 25;
// The projection has fewer than 25 bound columns, so 2k rows remain below the
// PostgreSQL bind limit and cut full-rebuild statement/trigger amplification.
const FEEDBACK_PROJECTION_INSERT_BATCH = 2_000;
function parentKey(event: Pick<DecodedSolana8004TrustEvent, "assetAddress" | "clientAddress" | "feedbackIndex">): string {
  return `${event.assetAddress}:${event.clientAddress}:${event.feedbackIndex}`;
}
function compatibilityValue(exactValue: string | null, score: number | null): number {
  if (score != null) return score;
  const parsed = exactValue == null ? 0 : Number(exactValue);
  return Number.isFinite(parsed) ? Math.max(-1_000_000, Math.min(1_000_000, parsed)) : 0;
}
function parentIntegrity(
  parents: ReadonlyMap<string, string>,
  key: string,
  sealHash: string,
): { status: Solana8004TrustStatus; integrity: Solana8004TrustIntegrity } {
  const parentSealHash = parents.get(key);
  if (!parentSealHash) return { status: "ORPHANED", integrity: "PARENT_MISSING" };
  if (parentSealHash !== sealHash) return { status: "INVALID", integrity: "MISMATCH" };
  return { status: "FINALIZED", integrity: "MATCH" };
}
async function reconcileChildren(tx: Prisma.TransactionClient, key: string, sealHash: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE solana_8004_trust_observations
    SET
      status = CASE WHEN seal_hash = ${sealHash} THEN 'FINALIZED' ELSE 'INVALID' END,
      integrity_status = CASE WHEN seal_hash = ${sealHash} THEN 'MATCH' ELSE 'MISMATCH' END,
      revoked = CASE WHEN kind = 'REVOCATION' AND seal_hash = ${sealHash} THEN TRUE ELSE FALSE END,
      updated_at = now()
    WHERE parent_key = ${key}
      AND kind IN ('RESPONSE', 'REVOCATION')
  `;
}
async function rebuildAgentFeedback(
  tx: Prisma.TransactionClient,
  assetAddress: string,
  programId: string,
  prefetchedMembership?: { agentDbId: number; isCurrent: boolean } | null,
): Promise<{ agentId: number | null; chainId: number | null; changed: boolean; onchainDelta: number }> {
  const membership = prefetchedMembership === undefined
    ? await tx.solanaRegistryMembership.findUnique({
      where: { source_externalId: { source: SOLANA_REGISTRY_SOURCE.SOLANA_8004, externalId: assetAddress } },
      select: { agentDbId: true, isCurrent: true },
    })
    : prefetchedMembership;
  if (!membership?.isCurrent) return { agentId: null, chainId: null, changed: false, onchainDelta: 0 };
  const agent = await tx.agent.findUnique({
    where: { id: membership.agentDbId },
    select: {
      id: true,
      chainId: true,
      solana8004FeedbackSourceDigest: true,
      sourceFeedbackCount: true,
      activityObservedAt: true,
      lastActiveAt: true,
    },
  });
  if (!agent) return { agentId: null, chainId: null, changed: false, onchainDelta: 0 };
  await tx.solana8004TrustObservation.updateMany({
    where: { assetAddress, agentDbId: null },
    data: { agentDbId: agent.id },
  });
  const trustEvents = await tx.solana8004TrustObservation.findMany({
    where: { assetAddress, kind: { in: ["FEEDBACK", "REVOCATION"] }, status: "FINALIZED" },
    orderBy: [{ slot: "asc" }, { eventOrdinal: "asc" }, { signature: "asc" }],
    select: {
      eventKey: true,
      parentKey: true,
      kind: true,
      rawValue: true,
      exactValue: true,
      valueDecimals: true,
      score: true,
      sealHash: true,
      signature: true,
      eventOrdinal: true,
      clientAddress: true,
      feedbackIndex: true,
      tag1: true,
      tag2: true,
      feedbackUri: true,
      status: true,
      slot: true,
      blockTime: true,
    },
  });
  const revocations: typeof trustEvents = [];
  const revokedKeys = new Set<string>();
  const feedbackByParent = new Map<string, (typeof trustEvents)[number]>();
  for (const event of trustEvents) {
    if (event.kind === "REVOCATION") {
      revocations.push(event);
      revokedKeys.add(event.parentKey);
      continue;
    }
    const existing = feedbackByParent.get(event.parentKey);
    if (existing && existing.eventKey !== event.eventKey) {
      throw new Error(`duplicate finalized Solana 8004 feedback identity: ${event.parentKey}`);
    }
    feedbackByParent.set(event.parentKey, event);
  }
  const canonicalFeedbacks = [...feedbackByParent.values()];
  // Stream the canonical projection into the digest instead of allocating a
  // second object graph and one history-sized JSON string for every update.
  const digestHash = createHash("sha256").update("feedbacks\0");
  for (const value of canonicalFeedbacks) {
    digestHash.update(JSON.stringify({
      key: value.parentKey,
      clientAddress: value.clientAddress,
      feedbackIndex: value.feedbackIndex.toString(10),
      rawValue: value.rawValue,
      exactValue: value.exactValue,
      valueDecimals: value.valueDecimals,
      score: value.score,
      tag1: value.tag1,
      tag2: value.tag2,
      feedbackUri: value.feedbackUri,
      sealHash: value.sealHash,
      revoked: revokedKeys.has(value.parentKey),
      signature: value.signature,
      slot: value.slot.toString(10),
      blockTime: value.blockTime?.toISOString() ?? null,
      eventOrdinal: value.eventOrdinal,
    })).update("\n");
  }
  digestHash.update("revocations\0");
  for (const value of revocations) {
    digestHash.update(JSON.stringify({
      key: value.parentKey,
      slot: value.slot.toString(10),
      blockTime: value.blockTime?.toISOString() ?? null,
      eventOrdinal: value.eventOrdinal,
      signature: value.signature,
    })).update("\n");
  }
  const digest = digestHash.digest("hex");
  if (agent.solana8004FeedbackSourceDigest === digest) {
    return { agentId: agent.id, chainId: agent.chainId, changed: false, onchainDelta: 0 };
  }
  const [removed] = await tx.$queryRaw<Array<{ active: bigint }>>`
    WITH deleted AS (
      DELETE FROM "Feedback"
      WHERE "agentId" = ${agent.id}
        AND source_registry = ${programId}
      RETURNING revoked
    )
    SELECT COUNT(*) FILTER (WHERE revoked = FALSE)::bigint AS active
    FROM deleted
  `;
  const previousActiveCount = Number(removed?.active ?? 0n);
  if (!Number.isSafeInteger(previousActiveCount)) {
    throw new Error("Solana feedback projection count exceeds the safe integer domain");
  }
  const rows = canonicalFeedbacks.flatMap((value) => value.feedbackIndex > POSTGRES_INT_MAX ? [] : [{
    agentId: agent.id,
    clientAddress: value.clientAddress,
    feedbackIndex: Number(value.feedbackIndex),
    value: compatibilityValue(value.exactValue, value.score),
    rawValue: value.rawValue,
    exactValue: value.exactValue,
    valueDecimals: value.valueDecimals ?? 0,
    tag1: value.tag1 ?? "",
    tag2: value.tag2 ?? "",
    comment: value.feedbackUri ?? "",
    revoked: revokedKeys.has(value.parentKey),
    qualityEligible: value.score != null,
    sourceRegistry: programId,
    sourceTxHash: value.signature,
    sourceBlockNumber: value.slot,
    sourceLogIndex: value.eventOrdinal,
    sourceFinality: value.status,
    chainSubmittedAt: value.blockTime,
  }]);
  for (let offset = 0; offset < rows.length; offset += FEEDBACK_PROJECTION_INSERT_BATCH) {
    await tx.feedback.createMany({
      data: rows.slice(offset, offset + FEEDBACK_PROJECTION_INSERT_BATCH),
    });
  }
  const latestFeedback = canonicalFeedbacks.at(-1);
  const latestRevocation = revocations.at(-1);
  const latest = latestFeedback == null
    ? latestRevocation
    : latestRevocation == null || latestFeedback.slot > latestRevocation.slot
      ? latestFeedback
      : latestRevocation;
  const activityAt = latest?.blockTime && (!agent.activityObservedAt || latest.blockTime > agent.activityObservedAt)
    ? latest.blockTime
    : agent.activityObservedAt ?? agent.lastActiveAt;
  await tx.agent.update({
    where: { id: agent.id },
    data: {
      solana8004FeedbackSourceDigest: digest,
      feedbackObservedBlock: latest?.slot ?? null,
      sourceFeedbackCount: 0,
      sourceQualityScore: null,
      activityObservedAt: activityAt,
      lastActiveAt: activityAt,
      lastIndexedAt: new Date(),
      scoreStateVersion: { increment: 1 },
    },
  });
  const nextActiveCount = rows.reduce((count, row) => count + (row.revoked ? 0 : 1), 0);
  return {
    agentId: agent.id,
    chainId: agent.chainId,
    changed: true,
    onchainDelta:
      nextActiveCount - previousActiveCount - Math.max(0, agent.sourceFeedbackCount ?? 0),
  };
}

async function projectAgentFeedbackParents(
  tx: Prisma.TransactionClient,
  assetAddress: string,
  programId: string,
  affectedParentKeys: readonly string[],
  prefetchedMembership?: { agentDbId: number; isCurrent: boolean } | null,
): Promise<{ agentId: number | null; chainId: number | null; changed: boolean; onchainDelta: number }> {
  if (affectedParentKeys.length === 0) {
    return { agentId: null, chainId: null, changed: false, onchainDelta: 0 };
  }
  const membership = prefetchedMembership === undefined
    ? await tx.solanaRegistryMembership.findUnique({
      where: {
        source_externalId: {
          source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
          externalId: assetAddress,
        },
      },
      select: { agentDbId: true, isCurrent: true },
    })
    : prefetchedMembership;
  if (!membership?.isCurrent) {
    return { agentId: null, chainId: null, changed: false, onchainDelta: 0 };
  }
  const agent = await tx.agent.findUnique({
    where: { id: membership.agentDbId },
    select: {
      id: true,
      chainId: true,
      sourceFeedbackCount: true,
      feedbackObservedBlock: true,
      activityObservedAt: true,
      lastActiveAt: true,
    },
  });
  if (!agent) return { agentId: null, chainId: null, changed: false, onchainDelta: 0 };

  await tx.solana8004TrustObservation.updateMany({
    where: { assetAddress, agentDbId: null },
    data: { agentDbId: agent.id },
  });
  const trustEvents = await tx.solana8004TrustObservation.findMany({
    where: {
      parentKey: { in: [...affectedParentKeys] },
      kind: { in: ["FEEDBACK", "REVOCATION"] },
      status: "FINALIZED",
    },
    orderBy: [{ slot: "asc" }, { eventOrdinal: "asc" }, { signature: "asc" }],
    select: {
      eventKey: true,
      parentKey: true,
      kind: true,
      rawValue: true,
      exactValue: true,
      valueDecimals: true,
      score: true,
      sealHash: true,
      signature: true,
      eventOrdinal: true,
      clientAddress: true,
      feedbackIndex: true,
      tag1: true,
      tag2: true,
      feedbackUri: true,
      status: true,
      slot: true,
      blockTime: true,
    },
  });
  const feedbackByParent = new Map<string, (typeof trustEvents)[number]>();
  const revokedKeys = new Set<string>();
  const revocations: typeof trustEvents = [];
  for (const event of trustEvents) {
    if (event.kind === "REVOCATION") {
      revocations.push(event);
      revokedKeys.add(event.parentKey);
      continue;
    }
    const existing = feedbackByParent.get(event.parentKey);
    if (existing && existing.eventKey !== event.eventKey) {
      throw new Error(`duplicate finalized Solana 8004 feedback identity: ${event.parentKey}`);
    }
    feedbackByParent.set(event.parentKey, event);
  }
  const canonicalFeedbacks = [...feedbackByParent.values()];
  if (canonicalFeedbacks.length === 0) {
    return { agentId: agent.id, chainId: agent.chainId, changed: false, onchainDelta: 0 };
  }
  const materializedFeedbacks = canonicalFeedbacks.filter(
    (feedback) => feedback.feedbackIndex <= POSTGRES_INT_MAX,
  );
  let previousActiveCount = 0;
  if (materializedFeedbacks.length > 0) {
    const [removed] = await tx.$queryRaw<Array<{ active: bigint }>>(Prisma.sql`
      WITH deleted AS (
        DELETE FROM "Feedback"
        WHERE "agentId" = ${agent.id}
          AND source_registry = ${programId}
          AND ("clientAddress", "feedbackIndex") IN (
            ${Prisma.join(materializedFeedbacks.map((feedback) => Prisma.sql`(
              ${feedback.clientAddress},
              ${Number(feedback.feedbackIndex)}
            )`))}
          )
        RETURNING revoked
      )
      SELECT COUNT(*) FILTER (WHERE revoked = FALSE)::bigint AS active
      FROM deleted
    `);
    previousActiveCount = Number(removed?.active ?? 0n);
    if (!Number.isSafeInteger(previousActiveCount)) {
      throw new Error("Solana feedback projection count exceeds the safe integer domain");
    }
  }
  const rows = materializedFeedbacks.map((value) => ({
    agentId: agent.id,
    clientAddress: value.clientAddress,
    feedbackIndex: Number(value.feedbackIndex),
    value: compatibilityValue(value.exactValue, value.score),
    rawValue: value.rawValue,
    exactValue: value.exactValue,
    valueDecimals: value.valueDecimals ?? 0,
    tag1: value.tag1 ?? "",
    tag2: value.tag2 ?? "",
    comment: value.feedbackUri ?? "",
    revoked: revokedKeys.has(value.parentKey),
    qualityEligible: value.score != null,
    sourceRegistry: programId,
    sourceTxHash: value.signature,
    sourceBlockNumber: value.slot,
    sourceLogIndex: value.eventOrdinal,
    sourceFinality: value.status,
    chainSubmittedAt: value.blockTime,
  }));
  for (let offset = 0; offset < rows.length; offset += FEEDBACK_PROJECTION_INSERT_BATCH) {
    await tx.feedback.createMany({
      data: rows.slice(offset, offset + FEEDBACK_PROJECTION_INSERT_BATCH),
    });
  }
  const feedbackEvents = canonicalFeedbacks;
  const latestFeedback = feedbackEvents.at(-1);
  const latestRevocation = revocations.at(-1);
  const latest = latestFeedback == null
    ? latestRevocation
    : latestRevocation == null || latestFeedback.slot > latestRevocation.slot
      ? latestFeedback
      : latestRevocation;
  const activityAt = latest?.blockTime &&
      (!agent.activityObservedAt || latest.blockTime > agent.activityObservedAt)
    ? latest.blockTime
    : agent.activityObservedAt ?? agent.lastActiveAt;
  const feedbackObservedBlock = latest &&
      (agent.feedbackObservedBlock == null || latest.slot > agent.feedbackObservedBlock)
    ? latest.slot
    : agent.feedbackObservedBlock;
  await tx.agent.update({
    where: { id: agent.id },
    data: {
      // Normal ingestion is now parent-key incremental. Null prevents the
      // one-time attachment rebuild from mistaking an incremental marker for a
      // canonical full-history digest.
      solana8004FeedbackSourceDigest: null,
      feedbackObservedBlock,
      sourceFeedbackCount: 0,
      sourceQualityScore: null,
      activityObservedAt: activityAt,
      lastActiveAt: activityAt,
      lastIndexedAt: new Date(),
      scoreStateVersion: { increment: 1 },
    },
  });
  const nextActiveCount = rows.reduce(
    (count, row) => count + (row.revoked ? 0 : 1),
    0,
  );
  return {
    agentId: agent.id,
    chainId: agent.chainId,
    changed: true,
    onchainDelta:
      nextActiveCount - previousActiveCount - Math.max(0, agent.sourceFeedbackCount ?? 0),
  };
}

export async function persistSolana8004TrustEvents(input: {
  programId: string;
  signature: string;
  transactionSlot: bigint;
  blockTime: Date | null;
  endpointKey: string;
  events: readonly DecodedSolana8004TrustEvent[];
}): Promise<{ observations: number; affectedAgentIds: number[] }> {
  return withDatabaseConcurrencyRetry(() => prisma.$transaction(async (tx) => {
    await acquireSolanaSnapshotWriterFence(tx);
    const assetSet = new Set<string>();
    const eventParentKeySet = new Set<string>();
    const feedbackParentKeySet = new Set<string>();
    const parentKeys = new Array<string>(input.events.length);
    for (let index = 0; index < input.events.length; index++) {
      const event = input.events[index]!;
      const key = parentKey(event);
      parentKeys[index] = key;
      assetSet.add(event.assetAddress);
      eventParentKeySet.add(key);
      if (event.kind === "FEEDBACK") feedbackParentKeySet.add(key);
    }
    const assets = [...assetSet].sort();
    if (assets.length > 0) await acquireSolanaAgentIdentityLocks(tx, assets.map((asset) => `asset:${asset}`));
    const memberships = assets.length === 0
      ? []
      : await tx.solanaRegistryMembership.findMany({
        where: {
          source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
          externalId: { in: assets },
        },
        select: { externalId: true, agentDbId: true, isCurrent: true, rawData: true },
      });
    const membershipsByAsset = new Map<string, (typeof memberships)[number]>();
    for (const membership of memberships) membershipsByAsset.set(membership.externalId, membership);
    const eventParentKeys = [...eventParentKeySet];
    const existingParents = eventParentKeys.length === 0
      ? []
      : await tx.solana8004TrustObservation.findMany({
        where: { parentKey: { in: eventParentKeys }, kind: "FEEDBACK" },
        orderBy: [{ slot: "asc" }, { eventOrdinal: "asc" }],
        select: { parentKey: true, sealHash: true },
      });
    const parentSeals = new Map<string, string>();
    for (const parent of existingParents) {
      if (!parentSeals.has(parent.parentKey)) parentSeals.set(parent.parentKey, parent.sealHash);
    }
    const feedbackParentKeys = [...feedbackParentKeySet];
    const existingChildren = feedbackParentKeys.length === 0
      ? []
      : await tx.solana8004TrustObservation.findMany({
        where: {
          parentKey: { in: feedbackParentKeys },
          kind: { in: ["RESPONSE", "REVOCATION"] },
        },
        distinct: ["parentKey"],
        select: { parentKey: true },
      });
    const childrenNeedingReconcile = new Set<string>();
    for (const child of existingChildren) childrenNeedingReconcile.add(child.parentKey);
    const projectionParentKeysByAsset = new Map<string, Set<string>>();
    for (let eventIndex = 0; eventIndex < input.events.length; eventIndex++) {
      const event = input.events[eventIndex]!;
      if (event.sourceSlot !== input.transactionSlot) {
        throw new Error(`Solana 8004 event slot ${event.sourceSlot} does not match transaction slot ${input.transactionSlot}`);
      }
      const key = parentKeys[eventIndex]!;
      const relationship = event.kind === "FEEDBACK"
        ? { status: "FINALIZED" as const, integrity: "SELF" as const }
        : parentIntegrity(parentSeals, key, event.sealHash);
      const membership = membershipsByAsset.get(event.assetAddress);
      const raw = membership?.rawData && typeof membership.rawData === "object" && !Array.isArray(membership.rawData)
        ? membership.rawData as Record<string, unknown>
        : null;
      const agentAccountPda = typeof raw?.agentAccountPda === "string" ? raw.agentAccountPda : null;
      const instruction = event.instruction;
      const eventKey = `${input.signature}:${event.eventOrdinal}:${event.kind.toLowerCase()}`;
      await tx.solana8004TrustObservation.upsert({
        where: { eventKey },
        create: {
          eventKey,
          parentKey: key,
          kind: event.kind,
          status: relationship.status,
          integrityStatus: relationship.integrity,
          programId: input.programId,
          agentAccountPda,
          assetAddress: event.assetAddress,
          clientAddress: event.clientAddress,
          responderAddress: event.responderAddress,
          feedbackIndex: event.feedbackIndex,
          rawValue: event.rawValue,
          valueDecimals: event.valueDecimals,
          exactValue: event.exactValue,
          score: event.score,
          feedbackFileHash: event.feedbackFileHash,
          tag1: instruction?.tag1 ?? null,
          tag2: instruction?.tag2 ?? null,
          endpoint: instruction?.endpoint ?? null,
          feedbackUri: instruction?.feedbackUri ?? null,
          responseUri: instruction?.responseUri ?? null,
          responseHash: event.responseHash ?? instruction?.responseHash ?? null,
          sealHash: event.sealHash,
          revoked: event.kind === "REVOCATION" && relationship.status === "FINALIZED",
          signature: input.signature,
          slot: input.transactionSlot,
          blockTime: input.blockTime,
          eventOrdinal: event.eventOrdinal,
          outerInstructionIndex: instruction?.outerInstructionIndex ?? null,
          innerInstructionOrdinal: instruction?.innerInstructionOrdinal ?? null,
          decoderVersion: SOLANA_8004_TRUST_DECODER_VERSION,
          rawData: { rawBase64: event.rawBase64, endpointKey: input.endpointKey },
          agentDbId: membership?.isCurrent ? membership.agentDbId : null,
        },
        update: {
          parentKey: key,
          status: relationship.status,
          integrityStatus: relationship.integrity,
          programId: input.programId,
          agentAccountPda,
          assetAddress: event.assetAddress,
          clientAddress: event.clientAddress,
          responderAddress: event.responderAddress,
          feedbackIndex: event.feedbackIndex,
          rawValue: event.rawValue,
          valueDecimals: event.valueDecimals,
          exactValue: event.exactValue,
          score: event.score,
          feedbackFileHash: event.feedbackFileHash,
          tag1: instruction?.tag1 ?? null,
          tag2: instruction?.tag2 ?? null,
          endpoint: instruction?.endpoint ?? null,
          feedbackUri: instruction?.feedbackUri ?? null,
          responseUri: instruction?.responseUri ?? null,
          responseHash: event.responseHash ?? instruction?.responseHash ?? null,
          sealHash: event.sealHash,
          revoked: event.kind === "REVOCATION" && relationship.status === "FINALIZED",
          slot: input.transactionSlot,
          blockTime: input.blockTime,
          outerInstructionIndex: instruction?.outerInstructionIndex ?? null,
          innerInstructionOrdinal: instruction?.innerInstructionOrdinal ?? null,
          decoderVersion: SOLANA_8004_TRUST_DECODER_VERSION,
          agentDbId: membership?.isCurrent ? membership.agentDbId : null,
          rawData: { rawBase64: event.rawBase64, endpointKey: input.endpointKey },
        },
      });
      if (event.kind === "FEEDBACK") {
        const keys = projectionParentKeysByAsset.get(event.assetAddress) ?? new Set<string>();
        keys.add(key);
        projectionParentKeysByAsset.set(event.assetAddress, keys);
        if (!parentSeals.has(key)) parentSeals.set(key, event.sealHash);
        if (childrenNeedingReconcile.has(key)) {
          await reconcileChildren(tx, key, event.sealHash);
        }
      } else {
        childrenNeedingReconcile.add(key);
        if (event.kind === "REVOCATION" && relationship.status === "FINALIZED") {
          const keys = projectionParentKeysByAsset.get(event.assetAddress) ?? new Set<string>();
          keys.add(key);
          projectionParentKeysByAsset.set(event.assetAddress, keys);
        }
      }
    }
    const affectedAgentIds: number[] = [];
    const countDeltas = new Map<number, number>();
    for (const asset of assets) {
      const membership = membershipsByAsset.get(asset) ?? null;
      const projectionParentKeys = [...(projectionParentKeysByAsset.get(asset) ?? [])];
      if (projectionParentKeys.length === 0) {
        if (membership?.isCurrent) affectedAgentIds.push(membership.agentDbId);
        continue;
      }
      const result = await projectAgentFeedbackParents(
        tx,
        asset,
        input.programId,
        projectionParentKeys,
        membership,
      );
      if (result.agentId != null) affectedAgentIds.push(result.agentId);
      if (result.changed && result.chainId != null && result.onchainDelta !== 0) {
        countDeltas.set(
          result.chainId,
          (countDeltas.get(result.chainId) ?? 0) + result.onchainDelta,
        );
      }
    }
    for (const [chainId, onchain] of countDeltas) {
      await adjustChainFeedbackCounts(tx, chainId, { onchain });
    }
    await tx.solana8004TrustSignature.update({
      where: { signature: input.signature },
      data: { status: "COMPLETE", endpointKey: input.endpointKey, completedAt: new Date(), lastError: null },
    });
    return { observations: input.events.length, affectedAgentIds };
  }, {
    // Per-asset advisory locks already serialize conflicting trust projections.
    // SERIALIZABLE takes its transaction snapshot before a contended advisory
    // lock returns, so queued writers can immediately fail with 40001 after
    // they finally acquire the lock. READ COMMITTED refreshes the snapshot per
    // statement while preserving the explicit lock/fence ordering above.
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 120_000,
    maxWait: 30_000,
  }));
}
export async function reconcileUnlinkedSolana8004TrustObservations(programId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ assetAddress: string }>>`
    SELECT DISTINCT observation.asset_address AS "assetAddress"
    FROM solana_8004_trust_observations AS observation
    INNER JOIN solana_registry_memberships AS membership
      ON membership.source = ${SOLANA_REGISTRY_SOURCE.SOLANA_8004}
      AND membership.external_id = observation.asset_address
      AND membership.is_current = TRUE
    WHERE observation.agent_db_id IS NULL
    ORDER BY observation.asset_address ASC
    LIMIT 250
  `;
  let linked = 0;
  for (let offset = 0; offset < rows.length; offset += UNLINKED_RECONCILIATION_BATCH_SIZE) {
    const assets = rows
      .slice(offset, offset + UNLINKED_RECONCILIATION_BATCH_SIZE)
      .map((row) => row.assetAddress)
      .sort();
    const result = await withDatabaseConcurrencyRetry(() => prisma.$transaction(async (tx) => {
      await acquireSolanaSnapshotWriterFence(tx);
      await acquireSolanaAgentIdentityLocks(tx, assets.map((asset) => `asset:${asset}`));
      const memberships = await tx.solanaRegistryMembership.findMany({
        where: {
          source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
          externalId: { in: assets },
        },
        select: { externalId: true, agentDbId: true, isCurrent: true },
      });
      const byAsset = new Map(memberships.map((membership) => [membership.externalId, membership]));
      let batchLinked = 0;
      const countDeltas = new Map<number, number>();
      for (const asset of assets) {
        const rebuilt = await rebuildAgentFeedback(
          tx,
          asset,
          programId,
          byAsset.get(asset) ?? null,
        );
        if (rebuilt.agentId != null) batchLinked += 1;
        if (rebuilt.changed && rebuilt.chainId != null && rebuilt.onchainDelta !== 0) {
          countDeltas.set(
            rebuilt.chainId,
            (countDeltas.get(rebuilt.chainId) ?? 0) + rebuilt.onchainDelta,
          );
        }
      }
      for (const [chainId, onchain] of countDeltas) {
        await adjustChainFeedbackCounts(tx, chainId, { onchain });
      }
      return { linked: batchLinked };
    }, {
      // See persistSolana8004TrustEvents: the identity locks provide the
      // serialization boundary, while READ COMMITTED avoids stale snapshots
      // for transactions that wait on those locks.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 120_000,
      maxWait: 30_000,
    }));
    linked += result.linked;
  }
  return linked;
}
