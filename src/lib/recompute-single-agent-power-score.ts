import type { PrismaClient } from "@/generated/prisma/client";
/** Any Prisma client or interactive transaction client with `$executeRaw`. */
export type AgentPowerSqlClient = Pick<PrismaClient, "$executeRaw">;
/** Match `runRankProjectionQueries` power calculation, scoped to one agent row. */
export async function recomputeBoostsAndListingPowerForAgent(
  db: AgentPowerSqlClient,
  agentPk: number,
): Promise<void> {
  await db.$executeRaw`
    WITH active_boosts AS (
      SELECT COALESCE(SUM(b."boostUnits"), 0)::INTEGER AS value
      FROM "AgentBoost" b
      WHERE b."agentId" = ${agentPk}
        AND b."expiresAt" > NOW()
    ), holder_power AS (
      SELECT COALESCE(SUM(h."boostUnits"), 0) AS value
      FROM "ArHolderAgentPerk" h
      WHERE h."agentId" = ${agentPk}
        AND h."perkType" = 'power_boost'
        AND h."status" = 'active'
        AND (h."expiresAt" IS NULL OR h."expiresAt" > NOW())
    ), desired AS (
      SELECT
        active_boosts.value AS active_boosts,
        GREATEST(0, ROUND(
          active_boosts.value
          + holder_power.value
          + COALESCE(agent."adminPowerAdjust", 0)
        ))::INTEGER AS power_score
      FROM "Agent" agent
      CROSS JOIN active_boosts
      CROSS JOIN holder_power
      WHERE agent.id = ${agentPk}
    )
    UPDATE "Agent" a
    SET
      "activeBoosts" = desired.active_boosts,
      "powerScore" = desired.power_score
    FROM desired
    WHERE a.id = ${agentPk}
      AND (a."activeBoosts", a."powerScore") IS DISTINCT FROM
        (desired.active_boosts, desired.power_score)
  `;
}
