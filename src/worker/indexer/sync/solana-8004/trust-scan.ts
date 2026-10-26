import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { throwIfAborted } from "../../lib/abort.js";
import { loadSolana8004ProgramDefinition } from "./program.js";
import {
  selectSolana8004HistoryRpcEndpoints,
  solanaRpcCall,
  type Solana8004RpcEndpoint,
} from "./rpc-client.js";
import { SOLANA_8004_TRUST_SOURCE_KEY } from "../solana-current-state-types.js";
import type { Solana8004TrustCursor } from "./trust-types.js";
import { enqueueSolana8004TrustScanContinuation, enqueueSolana8004TrustSyncBatch } from "../../queue/producer.js";
import { recordBootstrapSourceProgress } from "../../queue/bootstrap-progress.js";
import { getBootstrapExecutionState } from "../../queue/bootstrap-state.js";
import { SOLANA_CHAIN_ID } from "../../chain-constants.js";
import { reconcileUnlinkedSolana8004TrustObservations } from "./trust-projection.js";
import {
  SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS,
  SOLANA_8004_TRUST_STALE_QUEUE_RESERVATION_MS,
  SOLANA_8004_TRUST_STALE_RUNNING_MS,
} from "./trust-queue-policy.js";
const CURSOR_LOCK_SEED = 8_004_803;
const PENDING_DRAIN_RECHECK_SECONDS = 60;
const PROCESSING_SIGNATURE_STATUSES = ["PENDING", "QUEUED", "RUNNING", "FAILED"] as const;
type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  memo?: string | null;
  blockTime?: number | null;
  confirmationStatus?: string | null;
};
type HistoryPage = {
  endpoint: Solana8004RpcEndpoint;
  finalizedSlot: bigint;
  page: SignatureInfo[];
};
function defaultCursor(): Solana8004TrustCursor {
  return { version: 1, mode: "backfill", before: null, headSignature: null, passHeadSignature: null, targetSlot: null };
}
function parseCursor(value: string | null | undefined): Solana8004TrustCursor {
  if (!value) return defaultCursor();
  const parsed = JSON.parse(value) as Partial<Solana8004TrustCursor>;
  if (parsed.version !== 1 || (parsed.mode !== "backfill" && parsed.mode !== "tail")) {
    throw new Error("unsupported Solana 8004 trust cursor");
  }
  for (const key of ["before", "headSignature", "passHeadSignature", "targetSlot"] as const) {
    if (parsed[key] != null && typeof parsed[key] !== "string") throw new Error(`invalid Solana 8004 trust cursor ${key}`);
  }
  return {
    version: 1,
    mode: parsed.mode,
    before: parsed.before ?? null,
    headSignature: parsed.headSignature ?? null,
    passHeadSignature: parsed.passHeadSignature ?? null,
    targetSlot: parsed.targetSlot ?? null,
  };
}
function blockTime(value: number | null | undefined): Date | null {
  if (value == null || !Number.isSafeInteger(value)) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date;
}
async function persistDiscoveredSignatures(
  rows: SignatureInfo[],
  endpointKey: string,
): Promise<Array<{ signature: string; slot: string }>> {
  if (rows.length === 0) return [];
  const uniqueBySignature = new Map<string, SignatureInfo>();
  for (const row of rows) uniqueBySignature.set(row.signature, row);
  const uniqueRows = [...uniqueBySignature.values()];
  const observedAt = new Date();
  const durable = await prisma.$queryRaw<Array<{ signature: string; slot: bigint; status: string }>>(Prisma.sql`
    INSERT INTO "solana_8004_trust_signatures" AS existing (
      "signature", "slot", "block_time", "status", "completed_at", "endpoint_key", "updated_at"
    ) VALUES ${Prisma.join(uniqueRows.map((row) => {
      const failed = row.err != null;
      return Prisma.sql`(
        ${row.signature}, ${BigInt(row.slot)}, ${blockTime(row.blockTime)},
        ${failed ? "NO_TRUST" : "PENDING"}, ${failed ? observedAt : null}, ${endpointKey}, ${observedAt}
      )`;
    }))}
    ON CONFLICT ("signature") DO UPDATE SET
      "slot" = EXCLUDED."slot",
      "block_time" = EXCLUDED."block_time",
      "endpoint_key" = EXCLUDED."endpoint_key",
      "status" = CASE
        WHEN EXCLUDED."status" = 'NO_TRUST'
          AND existing."status" IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED', 'PRUNED', 'NO_TRUST') THEN 'NO_TRUST'
        WHEN EXCLUDED."status" = 'PENDING'
          AND existing."status" IN ('PRUNED', 'FAILED') THEN 'PENDING'
        ELSE existing."status"
      END,
      "completed_at" = CASE
        WHEN EXCLUDED."status" = 'NO_TRUST'
          AND existing."status" IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED', 'PRUNED', 'NO_TRUST') THEN EXCLUDED."completed_at"
        WHEN EXCLUDED."status" = 'PENDING'
          AND existing."status" IN ('PRUNED', 'FAILED') THEN NULL
        ELSE existing."completed_at"
      END,
      "last_error" = CASE
        WHEN EXCLUDED."status" = 'NO_TRUST'
          AND existing."status" IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED', 'PRUNED', 'NO_TRUST') THEN NULL
        WHEN EXCLUDED."status" = 'PENDING'
          AND existing."status" IN ('PRUNED', 'FAILED') THEN NULL
        ELSE existing."last_error"
      END,
      "updated_at" = EXCLUDED."updated_at"
    WHERE existing."slot" IS DISTINCT FROM EXCLUDED."slot"
       OR existing."block_time" IS DISTINCT FROM EXCLUDED."block_time"
       OR existing."endpoint_key" IS DISTINCT FROM EXCLUDED."endpoint_key"
       OR (
         EXCLUDED."status" = 'NO_TRUST'
         AND existing."status" IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED', 'PRUNED')
       )
       OR (
         EXCLUDED."status" = 'PENDING'
         AND existing."status" IN ('PRUNED', 'FAILED')
       )
    RETURNING "signature", "slot", "status"
  `);
  const pending: Array<{ signature: string; slot: string }> = [];
  for (const row of durable) {
    if (row.status === "PENDING" || row.status === "FAILED") {
      pending.push({ signature: row.signature, slot: row.slot.toString(10) });
    }
  }
  return pending;
}
function cursorToken(cursor: Solana8004TrustCursor): string {
  return createHash("sha256").update(JSON.stringify(cursor)).digest("hex").slice(0, 24);
}
function validateSignaturePage(page: unknown): asserts page is SignatureInfo[] {
  if (!Array.isArray(page)) throw new Error("Solana signature history response is not an array");
  for (const row of page) {
    if (row == null || typeof row !== "object") throw new Error("Solana signature history returned a malformed row");
    const candidate = row as Partial<SignatureInfo>;
    if (typeof candidate.signature !== "string" || candidate.signature.length === 0 || !Number.isSafeInteger(candidate.slot) || candidate.slot! < 0) {
      throw new Error("Solana signature history returned a malformed row");
    }
    if (candidate.blockTime != null && !Number.isSafeInteger(candidate.blockTime)) {
      throw new Error("Solana signature history returned an invalid block time");
    }
  }
}
async function fetchHistoryPage(input: {
  endpoints: readonly Solana8004RpcEndpoint[];
  programId: string;
  params: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<HistoryPage> {
  const failures: string[] = [];
  for (const endpoint of input.endpoints) {
    throwIfAborted(input.signal);
    try {
      const [finalizedSlotNumber, page] = await Promise.all([
        solanaRpcCall<number>(endpoint, "getSlot", [{ commitment: "finalized" }], input.signal, 1_048_576),
        solanaRpcCall<SignatureInfo[]>(endpoint, "getSignaturesForAddress", [input.programId, input.params], input.signal, 16 * 1024 * 1024),
      ]);
      if (!Number.isSafeInteger(finalizedSlotNumber) || finalizedSlotNumber < 0) throw new Error("Solana finalized slot is invalid");
      validateSignaturePage(page);
      return { endpoint, finalizedSlot: BigInt(finalizedSlotNumber), page };
    } catch (error) {
      failures.push(`${endpoint.providerName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Solana 8004 signature history is unavailable across compatible endpoints: ${failures.slice(0, 4).join("; ")}`);
}
async function recoverPrunedSignatures(minimumLedgerSlot: bigint): Promise<Array<{ signature: string; slot: string }>> {
  const recoverable = await prisma.$queryRaw<Array<{ signature: string; slot: bigint }>>(Prisma.sql`
    WITH candidates AS (
      SELECT signature
      FROM solana_8004_trust_signatures
      WHERE status = 'PRUNED'
        AND slot >= ${minimumLedgerSlot}
      ORDER BY slot ASC, signature ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${config.solana8004TrustTxBatchSize}
    )
    UPDATE solana_8004_trust_signatures AS target
    SET
      status = 'PENDING',
      completed_at = NULL,
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP
    FROM candidates
    WHERE target.signature = candidates.signature
      AND target.status = 'PRUNED'
    RETURNING target.signature, target.slot
  `);
  return recoverable.map((row) => ({ signature: row.signature, slot: row.slot.toString(10) }));
}
export type Solana8004TrustScanResult = {
  pageCount: number;
  enqueuedCount: number;
  mode: "backfill" | "tail";
  passComplete: boolean;
  bootstrapComplete: boolean;
  targetSlot: string;
  cursorToken: string;
};
export async function scanSolana8004TrustHistory(input: {
  requestedGeneration?: string;
  signal?: AbortSignal;
}): Promise<Solana8004TrustScanResult> {
  throwIfAborted(input.signal);
  const program = loadSolana8004ProgramDefinition();
  const [current, bootstrapState] = await Promise.all([
    prisma.indexerSourceCursor.findUnique({ where: { sourceKey: SOLANA_8004_TRUST_SOURCE_KEY } }),
    getBootstrapExecutionState(),
  ]);
  const cursor = parseCursor(current?.opaqueCursor);
  const requiredHistorySlot = cursor.mode === "backfill" ? config.solana8004TrustStartSlot : null;
  const endpoints = await selectSolana8004HistoryRpcEndpoints(program, requiredHistorySlot, input.signal);
  if (endpoints.length === 0) throw new Error("No compatible Solana 8004 history endpoint is available");
  if (requiredHistorySlot != null && endpoints[0]!.minimumLedgerSlot > requiredHistorySlot) {
    throw new Error(`Solana 8004 trust backfill requires history from slot ${requiredHistorySlot}, but the best provider starts at ${endpoints[0]!.minimumLedgerSlot}`);
  }
  const params: Record<string, unknown> = { limit: config.solana8004TrustPageSize, commitment: "finalized" };
  if (cursor.before) params.before = cursor.before;
  if (cursor.mode === "tail" && cursor.headSignature) params.until = cursor.headSignature;
  let scanEndpoints = endpoints;
  if (requiredHistorySlot != null) {
    scanEndpoints = [];
    for (const candidate of endpoints) {
      if (candidate.minimumLedgerSlot > requiredHistorySlot) break;
      scanEndpoints.push(candidate);
    }
  }
  const history = await fetchHistoryPage({ endpoints: scanEndpoints, programId: program.programId, params, signal: input.signal });
  const { endpoint, finalizedSlot, page } = history;
  const passIsStarting = cursor.before == null && cursor.passHeadSignature == null;
  if (cursor.targetSlot == null || (bootstrapState.phase === "STEADY" && passIsStarting)) {
    cursor.targetSlot = finalizedSlot.toString(10);
  }
  let reachedBackfillFloor = false;
  let acceptedPage = page;
  if (cursor.mode === "backfill") {
    acceptedPage = [];
    for (const row of page) {
      if (BigInt(row.slot) >= config.solana8004TrustStartSlot) acceptedPage.push(row);
      else reachedBackfillFloor = true;
    }
  }
  const syncRows = await persistDiscoveredSignatures(acceptedPage, endpoint.endpointKey);
  // History endpoints are cached in ascending minimum-ledger-slot order.
  const minimumLedgerSlot = endpoints[0]!.minimumLedgerSlot;
  syncRows.push(...await recoverPrunedSignatures(minimumLedgerSlot));
  const now = Date.now();
  const failedRetryBefore = new Date(now - SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS);
  const staleRunningBefore = new Date(now - SOLANA_8004_TRUST_STALE_RUNNING_MS);
  const staleQueuedBefore = new Date(now - SOLANA_8004_TRUST_STALE_QUEUE_RESERVATION_MS);
  const durablePending = await prisma.solana8004TrustSignature.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        { status: "FAILED", updatedAt: { lte: failedRetryBefore } },
        { status: "RUNNING", updatedAt: { lte: staleRunningBefore } },
        { status: "QUEUED", updatedAt: { lte: staleQueuedBefore } },
      ],
    },
    orderBy: [{ slot: "asc" }, { signature: "asc" }],
    take: config.solana8004TrustTxBatchSize,
    select: { signature: true, slot: true },
  });
  for (const row of durablePending) {
    syncRows.push({ signature: row.signature, slot: row.slot.toString(10) });
  }
  const enqueuedCount = await enqueueSolana8004TrustSyncBatch(syncRows);
  let passComplete = false;
  if (cursor.mode === "backfill") {
    if (!cursor.headSignature && acceptedPage[0]) cursor.headSignature = acceptedPage[0].signature;
    if (page.length === 0 || reachedBackfillFloor) {
      cursor.mode = "tail";
      cursor.before = null;
      cursor.passHeadSignature = null;
      passComplete = true;
    } else {
      cursor.before = page.at(-1)!.signature;
    }
  } else if (page.length === 0) {
    cursor.headSignature = cursor.passHeadSignature ?? cursor.headSignature;
    cursor.passHeadSignature = null;
    cursor.before = null;
    passComplete = true;
  } else {
    if (!cursor.passHeadSignature) cursor.passHeadSignature = page[0]!.signature;
    cursor.before = page.at(-1)!.signature;
  }
  const targetSlot = BigInt(cursor.targetSlot ?? finalizedSlot.toString(10));
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CURSOR_LOCK_SEED}, 1)`;
    await tx.indexerSourceCursor.upsert({
      where: { sourceKey: SOLANA_8004_TRUST_SOURCE_KEY },
      create: {
        sourceKey: SOLANA_8004_TRUST_SOURCE_KEY,
        chainId: SOLANA_CHAIN_ID,
        domain: "solana-8004-trust",
        registryAddress: program.programId,
        registryGeneration: program.idlHash,
        slot: targetSlot,
        signature: cursor.headSignature,
        opaqueCursor: JSON.stringify(cursor),
        finalityPolicy: "finalized-signature-history",
        sourceHead: finalizedSlot,
        canonicalHead: finalizedSlot,
        lastAdvancedAt: new Date(),
      },
      update: {
        registryAddress: program.programId,
        registryGeneration: program.idlHash,
        slot: targetSlot,
        signature: cursor.headSignature,
        opaqueCursor: JSON.stringify(cursor),
        sourceHead: finalizedSlot,
        canonicalHead: finalizedSlot,
        lastAdvancedAt: new Date(),
      },
    });
  });
  let pending = false;
  let discoveredCount: number | undefined;
  let prunedCount: number | undefined;
  let completedCount: number | undefined;
  let processingComplete = false;
  let hasPrunedHistory = false;
  if (cursor.mode === "tail" && passComplete) {
    pending = await prisma.solana8004TrustSignature.findFirst({
      where: { slot: { lte: targetSlot }, status: { in: [...PROCESSING_SIGNATURE_STATUSES] } },
      select: { signature: true },
    }) != null;
    if (!pending) {
      processingComplete = true;
      if (bootstrapState.phase === "TRUST") {
        const [counts] = await prisma.$queryRaw<Array<{
          discovered: bigint;
          completed: bigint;
          pruned: bigint;
        }>>`
          SELECT
            COUNT(*)::bigint AS discovered,
            COUNT(*) FILTER (WHERE status IN ('COMPLETE', 'NO_TRUST'))::bigint AS completed,
            COUNT(*) FILTER (WHERE status = 'PRUNED')::bigint AS pruned
          FROM solana_8004_trust_signatures
          WHERE slot <= ${targetSlot}
        `;
        const values = [counts?.discovered ?? 0n, counts?.completed ?? 0n, counts?.pruned ?? 0n];
        if (values.some((value) => value > BigInt(Number.MAX_SAFE_INTEGER))) {
          throw new Error("Solana 8004 trust progress exceeds the exact integer domain");
        }
        [discoveredCount, completedCount, prunedCount] = values.map(Number);
        hasPrunedHistory = (prunedCount ?? 0) > 0;
      } else {
        // Exact historical totals are only needed to close the bootstrap TRUST
        // phase. Afterwards, indexed existence is enough to preserve the
        // completeness/deferred decision without a table-scale aggregate.
        hasPrunedHistory = await prisma.solana8004TrustSignature.findFirst({
          where: { slot: { lte: targetSlot }, status: "PRUNED" },
          select: { signature: true },
        }) != null;
      }
    }
  }
  const bootstrapComplete = processingComplete && !hasPrunedHistory;
  if (processingComplete) await reconcileUnlinkedSolana8004TrustObservations(program.programId);
  await recordBootstrapSourceProgress({
    phase: "TRUST",
    sourceKey: SOLANA_8004_TRUST_SOURCE_KEY,
    complete: bootstrapComplete,
    targetSlot,
    ...(processingComplete ? { observedSlot: targetSlot } : {}),
    ...(discoveredCount !== undefined ? { discoveredCount } : {}),
    ...(completedCount !== undefined ? { completedCount } : {}),
    ...(prunedCount !== undefined ? { rejectedCount: prunedCount } : {}),
    ...(hasPrunedHistory ? { deferredReason: "solana_8004_history_pruned" } : {}),
  });
  if (!passComplete || pending) {
    await enqueueSolana8004TrustScanContinuation(
      input.requestedGeneration,
      cursorToken(cursor),
      passComplete && pending ? PENDING_DRAIN_RECHECK_SECONDS : 1,
    );
  }
  return {
    pageCount: acceptedPage.length,
    enqueuedCount,
    mode: cursor.mode,
    passComplete,
    bootstrapComplete,
    targetSlot: targetSlot.toString(10),
    cursorToken: cursorToken(cursor),
  };
}
