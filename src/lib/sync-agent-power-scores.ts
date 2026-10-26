import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient } from "@/generated/prisma/client";
/** Any Prisma client or interactive transaction client with raw query/update support. */
export type AgentPowerSqlClient = Pick<PrismaClient, "$executeRaw" | "$queryRaw">;
/** Sum active paid AgentBoost units into Agent.activeBoosts (all rows). */
export async function syncAllAgentActiveBoosts(db: AgentPowerSqlClient): Promise<void> {
  await db.$executeRaw`
    WITH active_boosts AS MATERIALIZED (
      SELECT b."agentId", SUM(b."boostUnits")::INTEGER AS value
      FROM "AgentBoost" b
      WHERE b."expiresAt" > NOW()
      GROUP BY b."agentId"
    ), desired AS (
      SELECT a.id, COALESCE(active_boosts.value, 0) AS value
      FROM "Agent" a
      LEFT JOIN active_boosts ON active_boosts."agentId" = a.id
    )
    UPDATE "Agent" a
    SET "activeBoosts" = desired.value
    FROM desired
    WHERE a.id = desired.id
      AND a."activeBoosts" IS DISTINCT FROM desired.value
  `;
}
/**
 * Recompute Agent.powerScore from boosts + holder power_boost perks + adminPowerAdjust.
 * Must stay aligned with power-score-formula.ts and rank-projection SQL.
 */
export async function syncAllAgentPowerScores(db: AgentPowerSqlClient): Promise<void> {
  await db.$executeRaw`
    WITH holder_power AS MATERIALIZED (
      SELECT h."agentId", SUM(h."boostUnits") AS value
      FROM "ArHolderAgentPerk" h
      WHERE h."perkType" = 'power_boost'
        AND h."status" = 'active'
        AND (h."expiresAt" IS NULL OR h."expiresAt" > NOW())
      GROUP BY h."agentId"
    ), desired AS (
      SELECT
        a.id,
        GREATEST(0, ROUND(
          a."activeBoosts"
          + COALESCE(holder_power.value, 0)
          + COALESCE(a."adminPowerAdjust", 0)
        ))::INTEGER AS value
      FROM "Agent" a
      LEFT JOIN holder_power ON holder_power."agentId" = a.id
    )
    UPDATE "Agent" a
    SET "powerScore" = desired.value
    FROM desired
    WHERE a.id = desired.id
      AND a."powerScore" IS DISTINCT FROM desired.value
  `;
}
/** Refresh activeBoosts then powerScore for every agent. */
export async function syncAllAgentListingPower(db: PrismaClient): Promise<void> {
  await db.$executeRaw`
    WITH active_boosts AS MATERIALIZED (
      SELECT b."agentId", SUM(b."boostUnits")::INTEGER AS value
      FROM "AgentBoost" b
      WHERE b."expiresAt" > NOW()
      GROUP BY b."agentId"
    ), holder_power AS MATERIALIZED (
      SELECT h."agentId", SUM(h."boostUnits") AS value
      FROM "ArHolderAgentPerk" h
      WHERE h."perkType" = 'power_boost'
        AND h."status" = 'active'
        AND (h."expiresAt" IS NULL OR h."expiresAt" > NOW())
      GROUP BY h."agentId"
    ), desired AS (
      SELECT
        a.id,
        COALESCE(active_boosts.value, 0) AS active_boosts,
        GREATEST(0, ROUND(
          COALESCE(active_boosts.value, 0)
          + COALESCE(holder_power.value, 0)
          + COALESCE(a."adminPowerAdjust", 0)
        ))::INTEGER AS power_score
      FROM "Agent" a
      LEFT JOIN active_boosts ON active_boosts."agentId" = a.id
      LEFT JOIN holder_power ON holder_power."agentId" = a.id
    )
    UPDATE "Agent" a
    SET
      "activeBoosts" = desired.active_boosts,
      "powerScore" = desired.power_score
    FROM desired
    WHERE a.id = desired.id
      AND (a."activeBoosts", a."powerScore") IS DISTINCT FROM
        (desired.active_boosts, desired.power_score)
  `;
}
const DEFAULT_BATCH_SIZE = 5_000;
/**
 * Batched listing-power sync for large DBs (avoids pooler/Postgres statement timeouts).
 */
export async function syncAllAgentListingPowerBatched(
  db: PrismaClient,
  opts?: { batchSize?: number; onBatch?: (fromId: number, toId: number) => void },
): Promise<void> {
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const agg = await db.agent.aggregate({ _max: { id: true }, _min: { id: true } });
  const minId = agg._min.id ?? 0;
  const maxId = agg._max.id ?? 0;
  if (maxId <= 0) return;
  for (let fromId = minId; fromId <= maxId; fromId += batchSize) {
    const toId = fromId + batchSize - 1;
    opts?.onBatch?.(fromId, toId);
    // Global maintenance must not wait on arbitrary Agent row locks held by
    // indexer transactions. Claim changed rows in primary-key order and skip
    // currently-owned rows; short follow-up passes pick up transient skips.
    // This removes the lock-order cycle that caused 40P01 failures while still
    // converging the projection during ordinary write traffic.
    for (let pass = 0; pass < 8; pass += 1) {
      const [result] = await db.$queryRaw<Array<{ desiredCount: number; updatedCount: number }>>`
        WITH active_boosts AS MATERIALIZED (
          SELECT b."agentId", SUM(b."boostUnits")::INTEGER AS value
          FROM "AgentBoost" b
          WHERE b."agentId" >= ${fromId}
            AND b."agentId" <= ${toId}
            AND b."expiresAt" > NOW()
          GROUP BY b."agentId"
        ), holder_power AS MATERIALIZED (
          SELECT h."agentId", SUM(h."boostUnits") AS value
          FROM "ArHolderAgentPerk" h
          WHERE h."agentId" >= ${fromId}
            AND h."agentId" <= ${toId}
            AND h."perkType" = 'power_boost'
            AND h.status = 'active'
            AND (h."expiresAt" IS NULL OR h."expiresAt" > NOW())
          GROUP BY h."agentId"
        ), desired AS MATERIALIZED (
          SELECT
            a.id,
            COALESCE(active_boosts.value, 0) AS active_boosts,
            GREATEST(0, ROUND(
              COALESCE(active_boosts.value, 0)
              + COALESCE(holder_power.value, 0)
              + COALESCE(a."adminPowerAdjust", 0)
            ))::INTEGER AS power_score
          FROM "Agent" a
          LEFT JOIN active_boosts ON active_boosts."agentId" = a.id
          LEFT JOIN holder_power ON holder_power."agentId" = a.id
          WHERE a.id >= ${fromId}
            AND a.id <= ${toId}
            AND (a."activeBoosts", a."powerScore") IS DISTINCT FROM (
              COALESCE(active_boosts.value, 0),
              GREATEST(0, ROUND(
                COALESCE(active_boosts.value, 0)
                + COALESCE(holder_power.value, 0)
                + COALESCE(a."adminPowerAdjust", 0)
              ))::INTEGER
            )
        ), locked AS MATERIALIZED (
          SELECT a.id
          FROM "Agent" a
          JOIN desired ON desired.id = a.id
          ORDER BY a.id ASC
          FOR UPDATE OF a SKIP LOCKED
        ), updated AS (
          UPDATE "Agent" a
          SET
            "activeBoosts" = desired.active_boosts,
            "powerScore" = desired.power_score
          FROM desired
          JOIN locked ON locked.id = desired.id
          WHERE a.id = desired.id
          RETURNING a.id
        )
        SELECT
          (SELECT COUNT(*)::INTEGER FROM desired) AS "desiredCount",
          (SELECT COUNT(*)::INTEGER FROM updated) AS "updatedCount"
      `;
      if (!result) throw new Error("listing-power projection returned no result");
      if (result.updatedCount >= result.desiredCount) break;
      if (pass < 7) {
        await delay(Math.min(250, 20 * 2 ** pass));
        continue;
      }
      throw new Error(
        `listing-power projection remained contended for Agent ids ${fromId}-${toId} after 8 passes ` +
          `(${result.updatedCount}/${result.desiredCount} rows updated)`,
      );
    }
  }
}
/** Drop live DAO rows for agents no longer on the board; re-rank survivors. */
export async function pruneDaoLeaderboardLiveToBoard(db: PrismaClient): Promise<void> {
  await db.$executeRaw`
    DELETE FROM "DaoLeaderboardLive" d
    USING "Agent" a
    WHERE a.id = d."agentId"
      AND (a."powerScore" <= 0 OR a."isActive" = false OR a."agentId" = 88888)
  `;
  await db.$executeRaw`
    WITH ranked AS (
      SELECT
        d.id,
        ROW_NUMBER() OVER (
          ORDER BY d."daoVotes" DESC, a.score DESC, a.id ASC
        ) AS new_rank
      FROM "DaoLeaderboardLive" d
      JOIN "Agent" a ON a.id = d."agentId"
      WHERE a."isActive" = true
        AND a."powerScore" > 0
    )
    UPDATE "DaoLeaderboardLive" d
    SET rank = r.new_rank,
        "updatedAt" = NOW()
    FROM ranked r
    WHERE d.id = r.id
      AND d.rank IS DISTINCT FROM r.new_rank
  `;
}
