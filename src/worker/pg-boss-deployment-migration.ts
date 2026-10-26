import { setTimeout as sleep } from "node:timers/promises";
import { PgBoss } from "pg-boss";
import { acquirePgBossMigrationLock } from "../jobs/pg-boss-deployment-lock";
import { JOB_QUEUES } from "../jobs/queues";
import {
  applyApplicationQueuePolicies,
  registerApplicationQueues,
} from "../jobs/register-queues";
import { config } from "./indexer/config.js";
import { INDEXER_QUEUES } from "./indexer/queue/queues.js";
import {
  applyIndexerQueuePolicies,
  registerIndexerQueues,
} from "./indexer/queue/register-queues.js";
import {
  solana8004TrustQueueTargetDepth,
} from "./indexer/sync/solana-8004/trust-queue-policy.js";
const BAM_POLL_INTERVAL_MS = 1_000;
const BAM_DRAIN_TIMEOUT_MS = 30 * 60_000;
const SAFE_PGBOSS_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function drainPgBossBackgroundMigrations(boss: PgBoss): Promise<void> {
  const deadline = Date.now() + BAM_DRAIN_TIMEOUT_MS;
  while (true) {
    const status = await boss.getBamStatus();
    const incomplete = status.reduce(
      (count, row) => count + (row.status === "completed" ? 0 : row.count),
      0,
    );
    if (incomplete === 0 && !boss.isBamWorking()) return;
    if (Date.now() >= deadline) {
      const entries = (await boss.getBamEntries())
        .filter((entry) => entry.status !== "completed")
        .slice(0, 20)
        .map((entry) => ({ name: entry.name, table: entry.table, status: entry.status, error: entry.error }));
      throw new Error(`pg-boss background migrations did not finish: ${JSON.stringify(entries)}`);
    }
    await sleep(BAM_POLL_INTERVAL_MS);
  }
}

async function repairPgBossManagedIndexes(boss: PgBoss): Promise<void> {
  const drift = await boss.detectSchemaDrift();
  const repairs = new Map<string, { name: string; definition?: string; dropFirst: boolean }>();
  for (const index of drift.missing) {
    repairs.set(`${index.table}:${index.name}`, { name: index.name, definition: index.definition, dropFirst: false });
  }
  for (const index of [...drift.invalid, ...drift.mismatched]) {
    repairs.set(`${index.table}:${index.name}`, { name: index.name, definition: index.definition, dropFirst: true });
  }
  const db = boss.getDb();
  for (const repair of repairs.values()) {
    if (!SAFE_PGBOSS_IDENTIFIER.test(repair.name) || !repair.definition) {
      throw new Error(`pg-boss reported an unsafe or incomplete managed index repair for ${repair.name}`);
    }
    if (repair.dropFirst) {
      await db.executeSql(`DROP INDEX IF EXISTS "pgboss"."${repair.name}"`);
    }
    await db.executeSql(repair.definition);
  }
  const verified = await boss.detectSchemaDrift();
  if (!verified.ok || verified.building.length > 0) {
    throw new Error("pg-boss managed schema is not current after deployment repair");
  }
}

async function ensureWorkerQueueIndexes(boss: PgBoss): Promise<void> {
  const db = boss.getDb();
  // pg-boss's managed ready index is ordered by start_after, which is ideal for
  // scheduled work but still requires a top-N UUID sort when consumers disable
  // priority/creation ordering. This partial index makes the exact hot claim
  // predicate stream in id order while excluding completed history. Keep only
  // rows the fetch predicate can actually claim: active and blocked rows would
  // otherwise sit ahead of ready work forever and make every poll walk past an
  // ever-growing prefix. INCLUDE keeps future start_after filtering index-only;
  // pg-boss's managed (name, start_after) index remains available when most of
  // a queue is scheduled for the future.
  await db.executeSql(`
    DO $repair_hot_queue_index$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS index_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = index_class.relnamespace
        JOIN pg_catalog.pg_index AS index_state
          ON index_state.indexrelid = index_class.oid
        WHERE namespace.nspname = 'pgboss'
          AND index_class.relname = 'job_hot_unsorted_i'
          AND (
            NOT index_state.indisvalid
            OR pg_catalog.pg_get_indexdef(index_class.oid) NOT LIKE '%(name, id)%'
            OR pg_catalog.pg_get_indexdef(index_class.oid) NOT LIKE '%INCLUDE (start_after)%'
            OR pg_catalog.pg_get_indexdef(index_class.oid) NOT LIKE '%state < ''active''%'
            OR pg_catalog.pg_get_indexdef(index_class.oid) NOT LIKE '%NOT blocked%'
          )
      ) THEN
        DROP INDEX pgboss.job_hot_unsorted_i;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS index_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = index_class.relnamespace
        JOIN pg_catalog.pg_index AS index_state
          ON index_state.indexrelid = index_class.oid
        WHERE namespace.nspname = 'pgboss'
          AND index_class.relname = 'job_deferred_singleton_i'
          AND (
            NOT index_state.indisvalid
            OR pg_catalog.pg_get_indexdef(index_class.oid) NOT LIKE '%state <= ''active''%'
          )
      ) THEN
        DROP INDEX pgboss.job_deferred_singleton_i;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS index_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = index_class.relnamespace
        JOIN pg_catalog.pg_index AS index_state
          ON index_state.indexrelid = index_class.oid
        WHERE namespace.nspname = 'pgboss'
          AND index_class.relname = 'job_completed_deletion_i'
          AND (
            NOT index_state.indisvalid
            OR pg_catalog.pg_get_indexdef(index_class.oid) NOT LIKE '%(name, completed_on)%'
            OR pg_catalog.pg_get_indexdef(index_class.oid) NOT LIKE '%completed_on IS NOT NULL%'
            OR pg_catalog.pg_get_indexdef(index_class.oid) NOT LIKE '%deletion_seconds > 0%'
          )
      ) THEN
        DROP INDEX pgboss.job_completed_deletion_i;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS index_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = index_class.relnamespace
        JOIN pg_catalog.pg_index AS index_state
          ON index_state.indexrelid = index_class.oid
        WHERE namespace.nspname = 'pgboss'
          AND index_class.relname = 'job_pending_expiration_i'
          AND NOT index_state.indisvalid
      ) THEN
        DROP INDEX pgboss.job_pending_expiration_i;
      END IF;
    END;
    $repair_hot_queue_index$
  `);
  await db.executeSql(`
    CREATE INDEX IF NOT EXISTS job_hot_unsorted_i
      ON pgboss.job (name, id)
      INCLUDE (start_after)
      WHERE state < 'active'
        AND NOT blocked
  `);
  // Agent-sync admission reads only the chain discriminator and stops at the
  // configured queue target. Keep that bounded count index-only instead of
  // decoding JSON from up to 100k heap tuples on every producer refresh.
  await db.executeSql(`
    CREATE INDEX IF NOT EXISTS job_agent_sync_occupancy_i
      ON pgboss.job ((data->>'chainId'))
      WHERE name = 'idx.agent.sync'
        AND state <= 'active'
  `);
  // Startup recovery updates existing deferred jobs by singleton key in pages.
  // Restrict this covering order to the queues that use that recovery path so
  // unrelated fan-out inserts do not pay for an extra index.
  await db.executeSql(`
    CREATE INDEX IF NOT EXISTS job_deferred_singleton_i
      ON pgboss.job (name, singleton_key, created_on DESC)
      WHERE state <= 'active'
        AND singleton_key IS NOT NULL
        AND name IN (
          'bounty.auto-release',
          'llm.deposit.expire',
          'llm.deposit.reconcile',
          'order.expire',
          'openrouter.generation.reconcile',
          'order.post-activation',
          'notification.deliver',
          'mesh.webhook.deliver',
          'alert.webhook.deliver',
          'launch.fee.reconcile'
        )
  `);
  // pg-boss's maintenance DELETE evaluates these two time predicates for
  // retained rows but does not ship matching managed indexes. PostgreSQL marks
  // timestamptz + interval as STABLE (timezone/DST rules can affect a generic
  // interval), so the completed-job expiration expression cannot legally be an
  // index key. Index the raw completion timestamp instead and keep the index
  // partial to terminal-retention rows, avoiding write amplification for the
  // much larger live/queued population. The expiration comparison is strict in
  // completed_on, so it implies completed_on IS NOT NULL; deletion_seconds > 0
  // is already an explicit conjunct in pg-boss's first maintenance OR branch.
  await db.executeSql(`
    CREATE INDEX IF NOT EXISTS job_completed_deletion_i
      ON pgboss.job (name, completed_on)
      WHERE completed_on IS NOT NULL
        AND deletion_seconds > 0
  `);
  await db.executeSql(`
    CREATE INDEX IF NOT EXISTS job_pending_expiration_i
      ON pgboss.job (name, keep_until)
      WHERE state < 'active'
  `);
}
async function repairQueuedMemoryExtractPayloads(boss: PgBoss): Promise<void> {
  // A previous producer spread the extraction-outbox row into the strict queue
  // contract, leaking dispatcher-only `attempts`. Repair queued retries in place
  // so already-delivered turns are not lost merely because the producer is fixed.
  const { rows } = await boss.getDb().executeSql(`
    WITH repaired AS (
      UPDATE pgboss.job
      SET data = data - 'attempts'
      WHERE name = $1
        AND state < 'active'
        AND jsonb_typeof(data) = 'object'
        AND data ? 'attempts'
      RETURNING 1
    )
    SELECT COUNT(*)::INTEGER AS repaired FROM repaired
  `, [JOB_QUEUES.MEMORY_EXTRACT]);
  const repaired = Number(rows[0]?.repaired ?? 0);
  if (!Number.isSafeInteger(repaired) || repaired < 0) {
    throw new Error("memory extraction queue repair returned an invalid count");
  }
  if (repaired > 0) {
    console.info("[pg-boss-migrate] repaired queued memory extraction payloads", {
      repaired,
    });
  }
}

async function trimLegacySolana8004TrustBacklog(boss: PgBoss): Promise<void> {
  const targetDepth = solana8004TrustQueueTargetDepth(
    config.solana8004TrustTxBatchSize,
  );
  const { rows } = await boss.getDb().executeSql(`
    WITH active_jobs AS MATERIALIZED (
      SELECT id, data->>'signature' AS signature
      FROM pgboss.job
      WHERE name = $1
        AND state = 'active'
    ), capacity AS MATERIALIZED (
      SELECT GREATEST($2::INTEGER - COUNT(*)::INTEGER, 0) AS pending_capacity
      FROM active_jobs
    ), pending_jobs AS MATERIALIZED (
      SELECT
        id,
        data->>'signature' AS signature,
        ROW_NUMBER() OVER (
          ORDER BY priority DESC NULLS LAST, created_on ASC, id ASC
        ) AS position
      FROM pgboss.job
      WHERE name = $1
        AND state < 'active'
    ), retained_pending AS MATERIALIZED (
      SELECT id, signature
      FROM pending_jobs
      WHERE position <= (SELECT pending_capacity FROM capacity)
    ), doomed AS MATERIALIZED (
      SELECT id, signature
      FROM pending_jobs
      WHERE position > (SELECT pending_capacity FROM capacity)
    ), deleted AS (
      DELETE FROM pgboss.job AS job
      USING doomed
      WHERE job.id = doomed.id
      RETURNING job.data->>'signature' AS signature
    ), retained_signatures AS MATERIALIZED (
      SELECT signature FROM active_jobs WHERE signature IS NOT NULL
      UNION
      SELECT signature FROM retained_pending WHERE signature IS NOT NULL
    ), released AS (
      UPDATE solana_8004_trust_signatures AS signature_state
      SET status = 'PENDING', updated_at = NOW()
      WHERE signature_state.status = 'QUEUED'
        AND EXISTS (
          SELECT 1
          FROM deleted
          WHERE deleted.signature = signature_state.signature
        )
        AND NOT EXISTS (
          SELECT 1
          FROM retained_signatures
          WHERE retained_signatures.signature = signature_state.signature
        )
      RETURNING signature_state.signature
    )
    SELECT
      (SELECT COUNT(*)::INTEGER FROM deleted) AS trimmed,
      (SELECT COUNT(*)::INTEGER FROM released) AS released,
      (SELECT COUNT(*)::INTEGER FROM active_jobs) AS active,
      (SELECT COUNT(*)::INTEGER FROM retained_pending) AS retained
  `, [INDEXER_QUEUES.SOLANA_8004_TRUST_SYNC, targetDepth]);
  const row = rows[0] as Record<string, unknown> | undefined;
  const trimmed = Number(row?.trimmed ?? 0);
  const released = Number(row?.released ?? 0);
  if (!Number.isSafeInteger(trimmed) || !Number.isSafeInteger(released)) {
    throw new Error("legacy Solana 8004 trust backlog repair returned invalid counts");
  }
  if (trimmed > 0) {
    console.info("[pg-boss-migrate] trimmed legacy Solana 8004 trust backlog", {
      trimmed,
      released,
      active: Number(row?.active ?? 0),
      retained: Number(row?.retained ?? 0),
      targetDepth,
    });
  }
}

/**
 * Upgrade the pg-boss-owned schema and reconcile application-owned queues.
 *
 * Production runtimes deliberately start pg-boss with schema migration
 * disabled. Deployment runs this command while every pg-boss runtime is
 * stopped, then ordinary startup verifies the actual queue definitions.
 */
export async function migratePgBossForDeployment(releaseId: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL!.trim();
  const normalizedReleaseId = releaseId.trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(normalizedReleaseId)) {
    throw new Error("deployment release id must contain 1-160 safe characters");
  }
  const boss = new PgBoss({
    connectionString: databaseUrl,
    application_name: "agentranking-pg-boss-deployment-migration",
    schema: "pgboss",
    max: 2,
    connectionTimeoutMillis: 20_000,
    useListenNotify: false,
    schedule: false,
    supervise: false,
    bamIntervalSeconds: 10,
    migrate: true,
    createSchema: true,
  });
  const migrationLock = await acquirePgBossMigrationLock(
    `deployment-${normalizedReleaseId}`,
  );
  let primaryError: unknown;
  try {
    await boss.start();
    await applyApplicationQueuePolicies(boss);
    await applyIndexerQueuePolicies(boss);
    await registerApplicationQueues(boss);
    await registerIndexerQueues(boss);
    await repairQueuedMemoryExtractPayloads(boss);
    // Older builds could materialize every discovered trust signature directly
    // into pg-boss. Current admission control is bounded, but that legacy queue
    // can survive deploys indefinitely. Repair it while all runtimes are stopped
    // and release deleted QUEUED reservations back to the durable signature table.
    await trimLegacySolana8004TrustBacklog(boss);
    await drainPgBossBackgroundMigrations(boss);
    await repairPgBossManagedIndexes(boss);
    await ensureWorkerQueueIndexes(boss);
    console.info("[pg-boss-migrate] schema and queues are current", {
      releaseId: normalizedReleaseId,
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const shutdownErrors: unknown[] = [];
    await boss.stop({
      graceful: false,
      close: true,
      timeout: 10_000,
    }).catch((error) => shutdownErrors.push(error));
    await migrationLock.release().catch((error) => shutdownErrors.push(error));
    if (shutdownErrors.length > 0) {
      if (primaryError !== undefined) {
        console.error(
          "[pg-boss-migrate] cleanup failed after migration error",
          new AggregateError(shutdownErrors),
        );
      } else {
        throw new AggregateError(
          shutdownErrors,
          "pg-boss deployment migration cleanup failed",
        );
      }
    }
  }
}
