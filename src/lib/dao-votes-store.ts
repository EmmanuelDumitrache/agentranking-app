import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { syncAllAgentListingPowerBatched } from "@/lib/sync-agent-power-scores";

type ProjectionPassResult = { desiredCount: number; updatedCount: number };

async function recomputeDaoLiveRanks(
  db: PrismaClient,
  eligibility: Prisma.Sql,
): Promise<void> {
  for (let pass = 0; pass < 6; pass += 1) {
    const [result] = await db.$queryRaw<ProjectionPassResult[]>(Prisma.sql`
      WITH ranked AS MATERIALIZED (
        SELECT
          d.id,
          ROW_NUMBER() OVER (
            ORDER BY d."daoVotes" DESC, a.score DESC, a.id ASC
          ) AS new_rank
        FROM "DaoLeaderboardLive" d
        JOIN "Agent" a ON a.id = d."agentId"
        WHERE a."isActive" = true
          AND (${eligibility})
      ), desired AS MATERIALIZED (
        SELECT d.id, COALESCE(ranked.new_rank, 0) AS new_rank
        FROM "DaoLeaderboardLive" d
        LEFT JOIN ranked ON ranked.id = d.id
        WHERE d.rank IS DISTINCT FROM COALESCE(ranked.new_rank, 0)
      ), locked AS MATERIALIZED (
        SELECT d.id
        FROM "DaoLeaderboardLive" d
        JOIN desired ON desired.id = d.id
        ORDER BY d.id ASC
        FOR UPDATE OF d SKIP LOCKED
      ), updated AS (
        UPDATE "DaoLeaderboardLive" d
        SET rank = desired.new_rank,
            "updatedAt" = NOW()
        FROM desired
        JOIN locked ON locked.id = desired.id
        WHERE d.id = desired.id
        RETURNING d.id
      )
      SELECT
        (SELECT COUNT(*)::INTEGER FROM desired) AS "desiredCount",
        (SELECT COUNT(*)::INTEGER FROM updated) AS "updatedCount"
    `);
    if (!result) throw new Error("DAO live-rank projection returned no result");
    if (result.updatedCount >= result.desiredCount) return;
    if (pass < 5) {
      await delay(Math.min(250, 25 * 2 ** pass));
      continue;
    }
    throw new Error(
      `DAO live-rank projection remained contended after 6 passes (${result.updatedCount}/${result.desiredCount} rows updated)`,
    );
  }
}

/**
 * Canonical DAO vote aggregation:
 * - paidBoostVotes = Agent.activeBoosts
 * - stakingVotes = sum(active holder power_boost units)
 * - adminVotes = Agent.adminPowerAdjust
 * - daoVotes = max(0, paidBoostVotes + stakingVotes + adminVotes)
 */
export async function recomputeDaoVotesLive(db: PrismaClient): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "DaoLeaderboardLive" (
      "agentId", "daoVotes", "stakingVotes", "adminVotes", "paidBoostVotes", rank, source, "updatedAt"
    )
    SELECT
      a.id AS "agentId",
      GREATEST(
        0,
        COALESCE(a."activeBoosts", 0)
        + COALESCE(hp."stakingVotes", 0)
        + COALESCE(a."adminPowerAdjust", 0)
      )::INTEGER AS "daoVotes",
      COALESCE(hp."stakingVotes", 0)::INTEGER AS "stakingVotes",
      COALESCE(a."adminPowerAdjust", 0)::INTEGER AS "adminVotes",
      COALESCE(a."activeBoosts", 0)::INTEGER AS "paidBoostVotes",
      0,
      'aggregated',
      NOW()
    FROM "Agent" a
    LEFT JOIN (
      SELECT
        h."agentId",
        SUM(h."boostUnits")::INTEGER AS "stakingVotes"
      FROM "ArHolderAgentPerk" h
      WHERE h."perkType" = 'power_boost'
        AND h.status = 'active'
        AND (h."expiresAt" IS NULL OR h."expiresAt" > NOW())
      GROUP BY h."agentId"
    ) hp ON hp."agentId" = a.id
    WHERE a."agentId" != 88888
    ORDER BY a.id ASC
    ON CONFLICT ("agentId") DO UPDATE SET
      "daoVotes" = EXCLUDED."daoVotes",
      "stakingVotes" = EXCLUDED."stakingVotes",
      "adminVotes" = EXCLUDED."adminVotes",
      "paidBoostVotes" = EXCLUDED."paidBoostVotes",
      source = EXCLUDED.source,
      "updatedAt" = NOW()
    WHERE (
      "DaoLeaderboardLive"."daoVotes",
      "DaoLeaderboardLive"."stakingVotes",
      "DaoLeaderboardLive"."adminVotes",
      "DaoLeaderboardLive"."paidBoostVotes",
      "DaoLeaderboardLive".source
    ) IS DISTINCT FROM (
      EXCLUDED."daoVotes",
      EXCLUDED."stakingVotes",
      EXCLUDED."adminVotes",
      EXCLUDED."paidBoostVotes",
      EXCLUDED.source
    );
  `);
  await recomputeDaoLiveRanks(
    db,
    Prisma.sql`
      d."daoVotes" > 0
      OR d."stakingVotes" > 0
      OR d."adminVotes" != 0
      OR d."paidBoostVotes" > 0
    `,
  );
}
/** Upsert DaoLeaderboardLive for specific agents only (fast admin path). */
export async function upsertDaoVotesLiveForAgents(
  db: PrismaClient,
  agentInternalIds: number[],
): Promise<void> {
  if (agentInternalIds.length === 0) return;
  const sortedAgentInternalIds = [...new Set(agentInternalIds)].sort(
    (a, b) => a - b,
  );
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "DaoLeaderboardLive" (
      "agentId", "daoVotes", "stakingVotes", "adminVotes", "paidBoostVotes", rank, source, "updatedAt"
    )
    SELECT
      a.id AS "agentId",
      GREATEST(
        0,
        COALESCE(a."activeBoosts", 0)
        + COALESCE(hp."stakingVotes", 0)
        + COALESCE(a."adminPowerAdjust", 0)
      )::INTEGER AS "daoVotes",
      COALESCE(hp."stakingVotes", 0)::INTEGER AS "stakingVotes",
      COALESCE(a."adminPowerAdjust", 0)::INTEGER AS "adminVotes",
      COALESCE(a."activeBoosts", 0)::INTEGER AS "paidBoostVotes",
      0,
      'aggregated',
      NOW()
    FROM "Agent" a
    LEFT JOIN (
      SELECT
        h."agentId",
        SUM(h."boostUnits")::INTEGER AS "stakingVotes"
      FROM "ArHolderAgentPerk" h
      WHERE h."perkType" = 'power_boost'
        AND h.status = 'active'
        AND (h."expiresAt" IS NULL OR h."expiresAt" > NOW())
      GROUP BY h."agentId"
    ) hp ON hp."agentId" = a.id
    WHERE a.id IN (${Prisma.join(sortedAgentInternalIds)})
    ORDER BY a.id ASC
    ON CONFLICT ("agentId") DO UPDATE SET
      "daoVotes" = EXCLUDED."daoVotes",
      "stakingVotes" = EXCLUDED."stakingVotes",
      "adminVotes" = EXCLUDED."adminVotes",
      "paidBoostVotes" = EXCLUDED."paidBoostVotes",
      source = EXCLUDED.source,
      "updatedAt" = NOW()
    WHERE (
      "DaoLeaderboardLive"."daoVotes",
      "DaoLeaderboardLive"."stakingVotes",
      "DaoLeaderboardLive"."adminVotes",
      "DaoLeaderboardLive"."paidBoostVotes",
      "DaoLeaderboardLive".source
    ) IS DISTINCT FROM (
      EXCLUDED."daoVotes",
      EXCLUDED."stakingVotes",
      EXCLUDED."adminVotes",
      EXCLUDED."paidBoostVotes",
      EXCLUDED.source
    );
  `);
  await recomputeDaoLiveRanks(db, Prisma.sql`a."powerScore" > 0`);
}
/** Full refresh: sync Agent.powerScore from boosts/perks/admin, then upsert live DAO table. */
export async function refreshDaoVotesWithPowerSync(db: PrismaClient): Promise<void> {
  await syncAllAgentListingPowerBatched(db);
  await recomputeDaoVotesLive(db);
}
export async function snapshotDaoVotes(db: PrismaClient, periodKey: "day" | "week" = "day"): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "DaoLeaderboardSnapshot" ("capturedAt", "periodKey", "agentId", "daoVotes", "stakingVotes", "adminVotes", rank)
    SELECT NOW(), ${periodKey}, d."agentId", d."daoVotes", d."stakingVotes", d."adminVotes", d.rank
    FROM "DaoLeaderboardLive" d
    WHERE d.rank > 0;
  `);
}
