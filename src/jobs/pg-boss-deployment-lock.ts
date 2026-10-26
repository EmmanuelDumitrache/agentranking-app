import pg from "pg";
const ADVISORY_LOCK_CLASS_ID = 0x4152474b;
const ADVISORY_LOCK_OBJECT_ID = 0x50474253;
const RUNTIME_APPLICATION_NAMES = [
  "agentranking-worker-pg-boss",
  "agentranking-pg-boss-worker",
  "agentranking-pg-boss-producer",
] as const;
type LockMode = "runtime" | "migration";
export type PgBossAdvisoryLock = {
  release(): Promise<void>;
};
type BooleanRow = {
  acquired?: boolean;
  released?: boolean;
};
type RuntimeSessionRow = {
  applicationName: string;
  connectionCount: number | string;
};
function requireDatabaseUrl(): string {
  return process.env.DATABASE_URL!.trim();
}
function applicationName(mode: LockMode, owner: string): string {
  const normalized = owner.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 40);
  return `agentranking-pg-boss-${mode}-lock-${normalized}`.slice(0, 63);
}
async function closeClient(client: pg.Client): Promise<void> {
  await client.end();
}
async function acquireLock(mode: LockMode, owner: string): Promise<PgBossAdvisoryLock> {
  const client = new pg.Client({
    connectionString: requireDatabaseUrl(),
    application_name: applicationName(mode, owner),
    connectionTimeoutMillis: 20_000,
  });
  const shared = mode === "runtime";
  try {
    await client.connect();
    const sql = shared
      ? "SELECT pg_try_advisory_lock_shared($1::integer, $2::integer) AS acquired"
      : "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired";
    const result = await client.query<BooleanRow>(sql, [
      ADVISORY_LOCK_CLASS_ID,
      ADVISORY_LOCK_OBJECT_ID,
    ]);
    if (result.rows[0]?.acquired !== true) {
      throw new Error(
        shared
          ? "exclusive pg-boss maintenance is active; worker or producer startup is blocked"
          : "a pg-boss worker or producer is active; stop every process using pg-boss before running exclusive pg-boss maintenance",
      );
    }
  } catch (error) {
    try {
      await closeClient(client);
    } catch (closeError) {
      throw new AggregateError([error, closeError], "pg-boss advisory lock startup failed");
    }
    throw error;
  }
  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      const sql = shared
        ? "SELECT pg_advisory_unlock_shared($1::integer, $2::integer) AS released"
        : "SELECT pg_advisory_unlock($1::integer, $2::integer) AS released";
      const errors: unknown[] = [];
      try {
        const result = await client.query<BooleanRow>(sql, [
          ADVISORY_LOCK_CLASS_ID,
          ADVISORY_LOCK_OBJECT_ID,
        ]);
        if (result.rows[0]?.released !== true) {
          errors.push(new Error("pg-boss maintenance advisory lock was not held by this session"));
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        await closeClient(client);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "pg-boss advisory lock release failed");
      }
    },
  };
}
export function acquirePgBossRuntimeLock(owner: string): Promise<PgBossAdvisoryLock> {
  return acquireLock("runtime", owner);
}
export async function acquirePgBossMigrationLock(
  owner: string,
): Promise<PgBossAdvisoryLock> {
  const lock = await acquireLock("migration", owner);
  const verifier = new pg.Client({
    connectionString: requireDatabaseUrl(),
    application_name: applicationName("migration", `${owner}-verify`),
    connectionTimeoutMillis: 20_000,
  });
  const errors: unknown[] = [];
  try {
    await verifier.connect();
    const result = await verifier.query<RuntimeSessionRow>(
      `
        SELECT application_name AS "applicationName", COUNT(*)::int AS "connectionCount"
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND application_name = ANY($1::text[])
        GROUP BY application_name
        ORDER BY application_name
      `,
      [RUNTIME_APPLICATION_NAMES],
    );
    if (result.rows.length > 0) {
      const sessions = result.rows
        .map((row) => `${row.applicationName}=${Number(row.connectionCount)}`)
        .join(", ");
      errors.push(
        new Error(
          `live pg-boss runtime connections remain (${sessions}); stop the web process and every worker before running exclusive pg-boss maintenance`,
        ),
      );
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    await closeClient(verifier);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    try {
      await lock.release();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(errors, "pg-boss migration lock verification failed");
  }
  return lock;
}
