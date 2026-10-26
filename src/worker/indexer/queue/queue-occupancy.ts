import type { PgBoss } from "pg-boss";

/** Indexed yes/no barrier; avoids pg-boss's aggregate queue-statistics query. */
export async function indexerQueuesAreDrained(
  boss: PgBoss,
  queueNames: readonly string[],
): Promise<boolean> {
  if (queueNames.length === 0) return true;
  const { rows } = await boss.getDb().executeSql(`
    SELECT EXISTS (
      SELECT 1
      FROM pgboss.job
      WHERE name = ANY($1::text[])
        AND state <= 'active'
      LIMIT 1
    ) AS occupied
  `, [[...queueNames]]);
  const occupied = rows[0]?.occupied;
  if (typeof occupied !== "boolean") {
    throw new Error("pg-boss queue occupancy probe returned an invalid result");
  }
  return !occupied;
}
