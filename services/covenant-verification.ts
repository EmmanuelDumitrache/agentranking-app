/**
 * Background OpenCovenant verification — caches results in AgentMetadata.
 * No per-page RPC; invoked from SAP sync cron or manual scripts.
 */
import { PublicKey } from "@solana/web3.js";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { covenantAgentListingWhere, isCovenantAgent } from "@/lib/covenant/detect";
import {
  COVENANT_DETECTED_AT_KEY,
  COVENANT_VERIFICATION_CHECKED_AT_KEY,
  COVENANT_VERIFICATION_SNAPSHOT_KEY,
  COVENANT_VERIFY_STALE_MS,
  resolveOpenCovenantProgramId,
} from "@/lib/covenant/config";
import {
  parseCovenantVerificationSnapshot,
  serializeCovenantVerificationSnapshot,
} from "@/lib/covenant/snapshot";
import { runCovenantVerification } from "@/lib/covenant/verify";
import { createSapClientWithFallback } from "@/lib/sap-rpc-client";
import { persistAgentScoresById } from "@/lib/persist-agent-scores";
export type CovenantVerificationBatchResult = {
  ok: boolean;
  scanned: number;
  verified: number;
  skippedStale: number;
  errors: Array<{ agentDbId: number; message: string }>;
  durationMs: number;
};
const COVENANT_VERIFICATION_CURSOR_SOURCE = "maintenance:covenant-verification";
const COVENANT_MAX_BATCH_SIZE = 500;
const COVENANT_ERROR_DETAIL_LIMIT = 100;
type AgentCovenantRow = {
  id: number;
  sapAgentPda: string | null;
  sapOwnerWallet: string | null;
  sapCapabilities: unknown;
  sapProtocols: string[];
  agentURI: string | null;
  isActive: boolean;
  metadata: Array<{ key: string; value: string }>;
};
function snapshotIsStale(metadata: Array<{ key: string; value: string }>): boolean {
  const snap = parseCovenantVerificationSnapshot(metadata);
  if (!snap?.checkedAt) return true;
  const t = Date.parse(snap.checkedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > COVENANT_VERIFY_STALE_MS;
}
async function upsertCovenantSnapshot(
  agentDbId: number,
  snapshotJson: string,
  detectedAt?: string,
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const snapshotValue = snapshotJson.slice(0, 12000);
  const detectedValue = detectedAt ?? null;
  // Preserve one canonical row per key and mutate only changed values. The old
  // delete/reinsert sequence rewrote every metadata index twice per verified
  // agent and briefly removed the freshness marker on every routine refresh.
  await prisma.$executeRaw`
    WITH desired(key, value) AS (
      SELECT ${COVENANT_VERIFICATION_SNAPSHOT_KEY}::text, ${snapshotValue}::text
      UNION ALL
      SELECT ${COVENANT_VERIFICATION_CHECKED_AT_KEY}::text, ${checkedAt}::text
      UNION ALL
      SELECT ${COVENANT_DETECTED_AT_KEY}::text, ${detectedValue}::text
      WHERE ${detectedValue}::text IS NOT NULL
    ), kept AS MATERIALIZED (
      SELECT DISTINCT ON (metadata.key) metadata.id, metadata.key, metadata.value
      FROM "AgentMetadata" AS metadata
      INNER JOIN desired ON desired.key = metadata.key
      WHERE metadata."agentId" = ${agentDbId}
      ORDER BY metadata.key, metadata.id
    ), updated AS (
      UPDATE "AgentMetadata" AS metadata
      SET value = desired.value
      FROM desired
      INNER JOIN kept ON kept.key = desired.key
      WHERE metadata.id = kept.id
        AND metadata.value IS DISTINCT FROM desired.value
      RETURNING metadata.id
    ), inserted AS (
      INSERT INTO "AgentMetadata" ("agentId", key, value)
      SELECT ${agentDbId}, desired.key, desired.value
      FROM desired
      WHERE NOT EXISTS (SELECT 1 FROM kept WHERE kept.key = desired.key)
      RETURNING id
    )
    DELETE FROM "AgentMetadata" AS metadata
    WHERE metadata."agentId" = ${agentDbId}
      AND metadata.key IN (
        ${COVENANT_VERIFICATION_SNAPSHOT_KEY},
        ${COVENANT_VERIFICATION_CHECKED_AT_KEY},
        ${COVENANT_DETECTED_AT_KEY}
      )
      AND NOT EXISTS (SELECT 1 FROM kept WHERE kept.id = metadata.id)
  `;
}
export async function runCovenantVerificationBatch(options?: {
  agentDbIds?: number[];
  limit?: number;
  force?: boolean;
}): Promise<CovenantVerificationBatchResult> {
  const started = Date.now();
  const errors: Array<{ agentDbId: number; message: string }> = [];
  let failed = 0;
  let scanned = 0;
  let verified = 0;
  let skippedStale = 0;
  const requestedLimit = options?.limit ?? 40;
  const limit = Math.max(
    1,
    Math.min(
      COVENANT_MAX_BATCH_SIZE,
      Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 40,
    ),
  );
  const targetedIds = options?.agentDbIds?.length
    ? [...new Set(options.agentDbIds)]
        .filter((id) => Number.isSafeInteger(id) && id > 0)
        .slice(0, limit)
    : undefined;
  const freshAfter = new Date(Date.now() - COVENANT_VERIFY_STALE_MS).toISOString();
  let cursor: number | null = null;
  if (!targetedIds) {
    const storedCursor = await prisma.indexerSourceCursor.findUnique({
      where: { sourceKey: COVENANT_VERIFICATION_CURSOR_SOURCE },
      select: { opaqueCursor: true },
    });
    try {
      const parsed = JSON.parse(storedCursor?.opaqueCursor ?? "null") as { lastId?: unknown } | null;
      const lastId = parsed?.lastId;
      cursor = typeof lastId === "number" && Number.isSafeInteger(lastId) && lastId > 0
        ? lastId
        : null;
    } catch {
      cursor = null;
    }
  }
  const where: Prisma.AgentWhereInput = {
    ...covenantAgentListingWhere(),
    sapAgentPda: { not: null },
    ...(targetedIds
      ? { id: { in: targetedIds } }
      : {
          sapVerified: true,
          // Select due work in SQL. Filtering freshness after LIMIT repeatedly
          // selected the same newest SAP rows and starved the rest forever.
          metadata: {
            none: {
              key: COVENANT_VERIFICATION_CHECKED_AT_KEY,
              value: { gte: freshAfter },
            },
          },
          ...(cursor == null ? {} : { id: { gt: cursor } }),
        }),
  };
  let rows = await prisma.agent.findMany({
    where,
    take: limit,
    orderBy: targetedIds ? { sapLastSyncedAt: "desc" } : { id: "asc" },
    select: {
      id: true,
      sapAgentPda: true,
      sapOwnerWallet: true,
      sapCapabilities: true,
      sapProtocols: true,
      agentURI: true,
      isActive: true,
      metadata: {
        where: { key: COVENANT_VERIFICATION_SNAPSHOT_KEY },
        select: { key: true, value: true },
      },
    },
  });
  // Wrap the durable cursor when the tail has no due candidates. Without a
  // cursor, the oldest IDs become stale again before a large directory reaches
  // its tail and permanently monopolize every bounded verification batch.
  if (!targetedIds && cursor != null && rows.length === 0) {
    cursor = null;
    rows = await prisma.agent.findMany({
      where: {
        ...covenantAgentListingWhere(),
        sapAgentPda: { not: null },
        sapVerified: true,
        metadata: {
          none: {
            key: COVENANT_VERIFICATION_CHECKED_AT_KEY,
            value: { gte: freshAfter },
          },
        },
      },
      take: limit,
      orderBy: { id: "asc" },
      select: {
        id: true,
        sapAgentPda: true,
        sapOwnerWallet: true,
        sapCapabilities: true,
        sapProtocols: true,
        agentURI: true,
        isActive: true,
        metadata: {
          where: { key: COVENANT_VERIFICATION_SNAPSHOT_KEY },
          select: { key: true, value: true },
        },
      },
    });
  }
  if (rows.length === 0) {
    if (!targetedIds && cursor == null) {
      const now = new Date();
      await prisma.indexerSourceCursor.upsert({
        where: { sourceKey: COVENANT_VERIFICATION_CURSOR_SOURCE },
        create: {
          sourceKey: COVENANT_VERIFICATION_CURSOR_SOURCE,
          domain: "covenant-verification",
          opaqueCursor: JSON.stringify({ v: 1, lastId: null }),
          lastAdvancedAt: now,
        },
        update: {
          opaqueCursor: JSON.stringify({ v: 1, lastId: null }),
          lastAdvancedAt: now,
        },
      });
    }
    return { ok: true, scanned: 0, verified: 0, skippedStale: 0, errors: [], durationMs: Date.now() - started };
  }
  let programPk: PublicKey;
  try {
    programPk = new PublicKey(resolveOpenCovenantProgramId());
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return {
      ok: false,
      scanned: 0,
      verified: 0,
      skippedStale: 0,
      errors: [{ agentDbId: 0, message: `Invalid SAP program id: ${msg}` }],
      durationMs: Date.now() - started,
    };
  }
  let connection;
  try {
    const bundle = await createSapClientWithFallback(programPk);
    connection = bundle.connection;
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return {
      ok: false,
      scanned: 0,
      verified: 0,
      skippedStale: 0,
      errors: [{ agentDbId: 0, message: `RPC unavailable: ${msg}` }],
      durationMs: Date.now() - started,
    };
  }
  for (const row of rows as AgentCovenantRow[]) {
    scanned++;
    if (!isCovenantAgent(row.sapProtocols, row.sapCapabilities)) continue;
    if (!options?.force && !snapshotIsStale(row.metadata)) {
      skippedStale++;
      continue;
    }
    const pda = row.sapAgentPda?.trim();
    if (!pda) continue;
    try {
      const snapshot = await runCovenantVerification(connection, programPk, {
        sapAgentPda: pda,
        sapOwnerWallet: row.sapOwnerWallet,
        sapCapabilities: row.sapCapabilities,
        agentURI: row.agentURI,
        isActive: row.isActive,
        indexedActive: row.isActive,
      });
      await upsertCovenantSnapshot(
        row.id,
        serializeCovenantVerificationSnapshot(snapshot),
        new Date().toISOString(),
      );
      await persistAgentScoresById(prisma, row.id);
      verified++;
    } catch (e) {
      const msg = Error.isError(e) ? e.message : String(e);
      failed++;
      if (errors.length < COVENANT_ERROR_DETAIL_LIMIT) {
        errors.push({ agentDbId: row.id, message: msg });
      }
    }
  }
  if (!targetedIds) {
    const lastId = rows.at(-1)?.id ?? null;
    const now = new Date();
    await prisma.indexerSourceCursor.upsert({
      where: { sourceKey: COVENANT_VERIFICATION_CURSOR_SOURCE },
      create: {
        sourceKey: COVENANT_VERIFICATION_CURSOR_SOURCE,
        domain: "covenant-verification",
        opaqueCursor: JSON.stringify({ v: 1, lastId }),
        lastAdvancedAt: now,
      },
      update: {
        opaqueCursor: JSON.stringify({ v: 1, lastId }),
        lastAdvancedAt: now,
      },
    });
  }
  return {
    ok: failed === 0,
    scanned,
    verified,
    skippedStale,
    errors,
    durationMs: Date.now() - started,
  };
}
/** Ensure the durable covenant detection marker exists on SAP upsert (no RPC). */
export function covenantDetectedMetadataEntry(): { key: string; value: string } {
  return { key: COVENANT_DETECTED_AT_KEY, value: new Date().toISOString() };
}
export async function touchCovenantDetectionMetadata(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  protocols: string[],
  capabilities?: unknown,
): Promise<void> {
  if (!isCovenantAgent(protocols, capabilities)) return;
  const entry = covenantDetectedMetadataEntry();
  const existing = await tx.agentMetadata.findMany({
    where: { agentId: agentDbId, key: entry.key },
    select: { id: true, sourceKind: true, sourceDigest: true, chainControlled: true },
    take: 2,
  });
  if (existing.length === 1) {
    const current = existing[0]!;
    // Consumers use this row as a durable presence marker; avoid rewriting its
    // timestamp and generating WAL on every otherwise-unchanged SAP sync.
    if (current.sourceKind === null && current.sourceDigest === null && !current.chainControlled) return;
    await tx.agentMetadata.update({
      where: { id: current.id },
      data: { sourceKind: null, sourceDigest: null, chainControlled: false },
    });
    return;
  }
  // Legacy data may contain duplicate metadata keys. Preserve the existing
  // singleton repair behavior without delete/reinsert churn on the normal path.
  if (existing.length > 1) {
    await tx.agentMetadata.deleteMany({
      where: { agentId: agentDbId, key: entry.key },
    });
  }
  await tx.agentMetadata.create({
    data: { agentId: agentDbId, key: entry.key, value: entry.value },
  });
}
