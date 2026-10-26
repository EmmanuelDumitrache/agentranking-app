import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient } from "@/generated/prisma/client";
import { recomputeDaoVotesLive, snapshotDaoVotes } from "@/lib/dao-votes-store";
import { syncAllAgentListingPowerBatched } from "@/lib/sync-agent-power-scores";

/** Reassign exact global organic rank from the materialized AR Score. */
export async function recomputeOrganicRanksOnly(prisma: PrismaClient): Promise<void> {
  // Rank recomputation is global, while normal indexer work updates individual
  // agents. Lock only rows that actually need a rank change, in primary-key
  // order, and skip rows already owned by another transaction. Follow-up passes
  // converge transient skips without participating in a deadlock cycle.
  for (let pass = 0; pass < 6; pass += 1) {
    const [result] = await prisma.$queryRaw<Array<{ desiredCount: number; updatedCount: number }>>`
      WITH ranked AS MATERIALIZED (
        SELECT
          a.id,
          ROW_NUMBER() OVER (ORDER BY a."agentRankScore" DESC, a.id ASC) AS rank
        FROM "Agent" a
        WHERE a."isActive" = TRUE
          AND a."agentId" <> 88888
          AND a."chainId" > 0
          AND btrim(a.name) <> ''
          AND (
            btrim(a.description) <> ''
            OR btrim(a.image) <> ''
            OR EXISTS (
              SELECT 1
              FROM "AgentMetadata" am
              WHERE am."agentId" = a.id
                AND (btrim(am.key) <> '' OR btrim(am.value) <> '')
            )
            OR EXISTS (
              SELECT 1
              FROM "AgentService" svc
              WHERE svc."agentId" = a.id
                AND btrim(svc.name) <> ''
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "AgentBlocklistRule" rule
            WHERE rule.active = TRUE
              AND btrim(rule.value) <> ''
              AND (
                (rule."matchType" = 'name_contains' AND position(lower(rule.value) IN lower(a.name)) > 0)
                OR (rule."matchType" = 'name_exact' AND lower(btrim(a.name)) = lower(btrim(rule.value)))
                OR (rule."matchType" = 'uri_contains' AND position(lower(rule.value) IN lower(a."agentURI")) > 0)
                OR (rule."matchType" = 'uri_exact' AND a."agentURI" = rule.value)
                OR (rule."matchType" = 'owner_wallet' AND lower(btrim(a.owner)) = lower(btrim(rule.value)))
                OR (rule."matchType" = 'agent_key' AND btrim(rule.value) = a."chainId"::text || ':' || a."agentId"::text)
              )
          )
      ), desired AS MATERIALIZED (
        SELECT a.id, COALESCE(ranked.rank, 0) AS rank
        FROM "Agent" a
        LEFT JOIN ranked ON ranked.id = a.id
        WHERE a.rank IS DISTINCT FROM COALESCE(ranked.rank, 0)
      ), locked AS MATERIALIZED (
        SELECT a.id
        FROM "Agent" a
        JOIN desired ON desired.id = a.id
        ORDER BY a.id ASC
        FOR UPDATE OF a SKIP LOCKED
      ), updated AS (
        UPDATE "Agent" a
        SET rank = desired.rank
        FROM desired
        JOIN locked ON locked.id = desired.id
        WHERE a.id = desired.id
        RETURNING a.id
      )
      SELECT
        (SELECT COUNT(*)::INTEGER FROM desired) AS "desiredCount",
        (SELECT COUNT(*)::INTEGER FROM updated) AS "updatedCount"
    `;
    if (!result) throw new Error("organic rank projection returned no result");
    if (result.updatedCount >= result.desiredCount) return;
    if (pass < 5) {
      await delay(Math.min(250, 25 * 2 ** pass));
      continue;
    }
    throw new Error(
      `organic rank projection remained contended after 6 passes (${result.updatedCount}/${result.desiredCount} rows updated)`,
    );
  }
}

/**
 * Cheap global projection pass. Per-Agent score materialization is event-driven
 * and is deliberately not repeated here.
 */
export async function runRankProjectionQueries(prisma: PrismaClient): Promise<void> {
  await syncAllAgentListingPowerBatched(prisma);
  await recomputeOrganicRanksOnly(prisma);
  await recomputeDaoVotesLive(prisma);
}

/** Historical sampling remains clock-driven because the timestamp is product data. */
export async function snapshotRankHistory(prisma: PrismaClient): Promise<number> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO "AgentRankSnapshot" (
      "agentId",
      rank,
      "archetypeRank",
      score,
      "agentRankScore",
      "capturedAt"
    )
    SELECT
      a.id,
      a.rank,
      CASE
        WHEN btrim(a.archetype) = '' THEN NULL
        ELSE ROW_NUMBER() OVER (
          PARTITION BY NULLIF(btrim(a.archetype), '')
          ORDER BY a.rank ASC, a.id ASC
        )::integer
      END,
      a.score,
      a."agentRankScore",
      now()
    FROM "Agent" a
    WHERE a.rank > 0
    ORDER BY a.rank ASC, a.id ASC
  `;
  const retentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);
  const retentionBatchSize = 10_000;
  const retentionMaxBatches = 20;
  for (let batch = 0; batch < retentionMaxBatches; batch += 1) {
    const deleted = await prisma.$executeRaw`
      WITH doomed AS (
        SELECT id
        FROM "AgentRankSnapshot"
        WHERE "capturedAt" < ${retentionCutoff}
        ORDER BY "capturedAt", id
        LIMIT ${retentionBatchSize}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "AgentRankSnapshot" snapshot
      USING doomed
      WHERE snapshot.id = doomed.id
    `;
    if (deleted < retentionBatchSize) break;
  }
  await snapshotDaoVotes(prisma, "day");
  return inserted;
}

/** Low-frequency integrity sweep; ordinary lifecycle changes should be event-driven. */
export async function deactivateOverdueAgents(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);
  const batchSize = 10_000;
  let deactivated = 0;
  for (;;) {
    const changed = await prisma.$executeRaw`
      WITH overdue AS (
        SELECT ctid
        FROM "Agent"
        WHERE "lastActiveAt" < ${cutoff}
          AND "isActive" = TRUE
          AND "isPremiumVerified" = FALSE
          AND "isVerified" = FALSE
        ORDER BY "lastActiveAt", id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "Agent" agent
      SET "isActive" = FALSE
      FROM overdue
      WHERE agent.ctid = overdue.ctid
    `;
    deactivated += changed;
    if (changed < batchSize) return deactivated;
  }
}
