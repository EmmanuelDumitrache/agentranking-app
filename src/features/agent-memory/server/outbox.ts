import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import { enqueueMemoryExtractBatch } from "./enqueue";

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_DISPATCH = 20;
const CLAIM_STALE_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const DELIVERED_RETENTION_MS = 30 * 24 * 60 * 60_000;
const DELIVERED_PRUNE_BATCH = 10_000;
const DELIVERED_PRUNE_MAX_BATCHES = 10;

type ClaimedMemoryExtraction = {
  sourceMessageId: string;
  sourceRunId: string;
  appAccountId: string;
  agentDbId: number;
  conversationId: string;
  attempts: number;
};

function retryAt(attempt: number): Date {
  const exponent = Math.min(8, Math.max(0, attempt - 1));
  const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** exponent);
  const jitter = Math.floor(Math.random() * Math.max(250, Math.floor(base / 4)));
  return new Date(Date.now() + Math.min(MAX_BACKOFF_MS, base + jitter));
}

async function dispatchMemoryExtractionOutboxBatch(): Promise<{
  claimed: number;
  delivered: number;
  deferred: number;
}> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  const claimToken = crypto.randomUUID();
  const claimed = await prisma.$queryRaw<ClaimedMemoryExtraction[]>(Prisma.sql`
    WITH candidates AS (
      SELECT source_message_id
      FROM agent_memory_extraction_outbox
      WHERE delivered_at IS NULL
        AND source_run_id IS NOT NULL
        AND available_at <= ${now}
        AND (claim_token IS NULL OR claimed_at < ${staleBefore})
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE agent_memory_extraction_outbox AS outbox
    SET
      claim_token = ${claimToken},
      claimed_at = ${now},
      attempts = outbox.attempts + 1,
      updated_at = ${now}
    FROM candidates
    WHERE outbox.source_message_id = candidates.source_message_id
      AND outbox.delivered_at IS NULL
    RETURNING
      outbox.source_message_id AS "sourceMessageId",
      outbox.source_run_id AS "sourceRunId",
      outbox.app_account_id AS "appAccountId",
      outbox.agent_db_id AS "agentDbId",
      outbox.conversation_id AS "conversationId",
      outbox.attempts
  `);
  if (claimed.length === 0) return { claimed: 0, delivered: 0, deferred: 0 };
  try {
    await enqueueMemoryExtractBatch(claimed);
    const finalized = await prisma.agentMemoryExtractionOutbox.updateMany({
      where: { claimToken, deliveredAt: null },
      data: {
        deliveredAt: new Date(),
        claimToken: null,
        claimedAt: null,
        lastError: null,
      },
    });
    return { claimed: claimed.length, delivered: finalized.count, deferred: 0 };
  } catch (error) {
    const safe = safeErrorDetails(error);
    const message = safe.message.slice(0, 2_000);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE agent_memory_extraction_outbox AS outbox
      SET
        claim_token = NULL,
        claimed_at = NULL,
        available_at = retry.available_at,
        last_error = ${message},
        updated_at = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(claimed.map((row) => Prisma.sql`(
        ${row.sourceMessageId}::text,
        ${retryAt(row.attempts)}::timestamptz
      )`))}) AS retry(source_message_id, available_at)
      WHERE outbox.source_message_id = retry.source_message_id
        AND outbox.claim_token = ${claimToken}
    `);
    console.error("[agent-memory] outbox batch delivery failed", {
      claimed: claimed.length,
      latestSourceMessageId: claimed.at(-1)?.sourceMessageId,
      error: safe,
    });
    return { claimed: claimed.length, delivered: 0, deferred: claimed.length };
  }
}

export async function dispatchMemoryExtractionOutbox(): Promise<{
  claimed: number;
  delivered: number;
  deferred: number;
}> {
  const total = { claimed: 0, delivered: 0, deferred: 0 };
  for (let batch = 0; batch < MAX_BATCHES_PER_DISPATCH; batch += 1) {
    const result = await dispatchMemoryExtractionOutboxBatch();
    total.claimed += result.claimed;
    total.delivered += result.delivered;
    total.deferred += result.deferred;
    if (result.deferred > 0 || result.claimed < BATCH_SIZE) break;
  }
  const deliveredBefore = new Date(Date.now() - DELIVERED_RETENTION_MS);
  for (let batch = 0; batch < DELIVERED_PRUNE_MAX_BATCHES; batch += 1) {
    const deleted = await prisma.$executeRaw`
      WITH delivered AS (
        SELECT source_message_id
        FROM agent_memory_extraction_outbox
        WHERE delivered_at < ${deliveredBefore}
        ORDER BY delivered_at ASC, source_message_id ASC
        LIMIT ${DELIVERED_PRUNE_BATCH}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM agent_memory_extraction_outbox AS outbox
      USING delivered
      WHERE outbox.source_message_id = delivered.source_message_id
    `;
    if (deleted < DELIVERED_PRUNE_BATCH) break;
  }
  return total;
}
