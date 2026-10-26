import { Client } from "pg";
import { createClient } from "redis";
import { enqueueGlobalRankProjection } from "@/jobs/rank-maintenance";
import { enqueueScoreRecalculationBatch } from "@/worker/indexer/queue/producer";
import { isBootstrapPhaseOpen } from "@/worker/indexer/queue/bootstrap-state";
import { AGENT_PUBLIC_CONTENT_CACHE_DOMAIN } from "@/lib/public-cache-domains";
import { classifyDatabaseError } from "@/worker/indexer/lib/database-errors";

const CHANNEL = "cache_invalidation";
const SHARED_PREFIX = "public-api:v1:";
const LEASE_PREFIX = "public-api-lock:v1:";
const GENERATION_PREFIX = "public-api-generation:";
const APPLIED_DB_REVISION_PREFIX = "public-api-db-revision:";
const APPLIED_DB_EPOCH_PREFIX = "public-api-db-epoch:v1:";
const BATCH_SIZE = 500;
const DISPATCH_MAX_ROWS_PER_DRAIN = 10_000;
const DISPATCH_CONTINUATION_DELAY_MS = 250;
const CLEANUP_BATCH_SIZE = 5_000;
const CLEANUP_MAX_ROWS_PER_DRAIN = 20_000;
const RETRY_DELAY_MS = 30_000;
const CONCURRENCY_RETRY_DELAY_MS = 250;
const DELIVERED_RETENTION_DAYS = 7;
const DISPATCH_LOCK_KEY = "agentranking:cache-invalidation-dispatcher:v1";

const APPLY_DB_REVISIONS_LUA = `
redis.setresp(3)
local function normalize_decimal(value)
  if value == nil or string.match(value, '^%d+$') == nil then return nil end
  local normalized = string.gsub(value, '^0+', '')
  if normalized == '' then return '0' end
  return normalized
end
local function compare_decimal(left, right)
  if string.len(left) < string.len(right) then return -1 end
  if string.len(left) > string.len(right) then return 1 end
  if left < right then return -1 end
  if left > right then return 1 end
  return 0
end
if (#KEYS % 3) ~= 0 then return redis.error_reply('invalid revision key count') end
local domain_count = #KEYS / 3
if #ARGV ~= domain_count + 1 then return redis.error_reply('invalid revision argument count') end
local database_epoch = ARGV[domain_count + 1]
if database_epoch == nil or database_epoch == '' then return redis.error_reply('invalid database epoch') end
local candidates = {}
local applied_revisions = {}
local applied_epochs = {}
for domain_index = 1, domain_count do
  local candidate = normalize_decimal(ARGV[domain_index])
  if candidate == nil then return redis.error_reply('invalid revision') end
  local key_offset = (domain_index - 1) * 3
  local revision_key = KEYS[key_offset + 2]
  local epoch_key = KEYS[key_offset + 3]
  local applied_raw = redis.call('GET', revision_key)
  local applied = '0'
  if applied_raw ~= false and applied_raw ~= nil then
    applied = normalize_decimal(applied_raw)
    if applied == nil then return redis.error_reply('invalid stored revision') end
  end
  local applied_epoch = redis.call('GET', epoch_key)
  candidates[domain_index] = candidate
  applied_revisions[domain_index] = applied
  applied_epochs[domain_index] = applied_epoch
end
for domain_index = 1, domain_count do
  local key_offset = (domain_index - 1) * 3
  if applied_epochs[domain_index] ~= database_epoch or compare_decimal(candidates[domain_index], applied_revisions[domain_index]) > 0 then
    local generation_key = KEYS[key_offset + 1]
    local revision_key = KEYS[key_offset + 2]
    local epoch_key = KEYS[key_offset + 3]
    redis.call('INCR', generation_key)
    redis.call('SET', revision_key, candidates[domain_index])
    redis.call('SET', epoch_key, database_epoch)
  end
end
return domain_count
`;

type PendingRow = { id: string; domain: string; revision: string; database_epoch: string };
type DomainBatch = {
  domain: string;
  revision: bigint;
  rows: PendingRow[];
};
type CacheInvalidationRedis = {
  sendCommand(command: string[]): Promise<unknown>;
  del(keys: string[]): Promise<number>;
};

export type CacheInvalidationDispatcher = { close(): Promise<void> };

function databaseUrl(): string {
  return process.env.DATABASE_URL!.trim();
}

function valkeyUrl(): string {
  return process.env.VALKEY_URL!.trim();
}

function isGenerationDomain(domain: string): boolean {
  return (
    domain === "powerboost" ||
    domain === "ranking" ||
    domain === "stats:lists" ||
    domain === "stats:top-by-chain" ||
    domain === AGENT_PUBLIC_CONTENT_CACHE_DOMAIN ||
    domain === "sap:twin-index" ||
    domain === "agent:rank-history" ||
    domain.startsWith("agent:payload:") ||
    domain.startsWith("agent:detail:") ||
    domain.startsWith("agent:cluster:") ||
    domain.startsWith("agents:list:")
  );
}

function scoreAgentId(domain: string): number | null {
  if (!domain.startsWith("derived:agent-score:")) return null;
  const rawAgentId = domain.slice("derived:agent-score:".length);
  if (!/^[1-9]\d*$/.test(rawAgentId)) {
    throw new Error(`Invalid score invalidation domain: ${domain}`);
  }
  const agentId = Number(rawAgentId);
  if (!Number.isSafeInteger(agentId)) {
    throw new Error(`Score invalidation Agent id exceeds safe integer range: ${domain}`);
  }
  return agentId;
}

async function applyGenerationDomains(
  redis: CacheInvalidationRedis,
  batches: readonly DomainBatch[],
  databaseEpoch: string,
): Promise<void> {
  if (batches.length === 0) return;
  const keys: string[] = [];
  const revisions: string[] = [];
  for (const batch of batches) {
    keys.push(
      `${GENERATION_PREFIX}${batch.domain}`,
      `${APPLIED_DB_REVISION_PREFIX}${batch.domain}`,
      `${APPLIED_DB_EPOCH_PREFIX}${batch.domain}`,
    );
    revisions.push(batch.revision.toString());
  }
  await redis.sendCommand([
    "EVAL",
    APPLY_DB_REVISIONS_LUA,
    String(keys.length),
    ...keys,
    ...revisions,
    databaseEpoch,
  ]);
}

export async function startCacheInvalidationDispatcher(): Promise<CacheInvalidationDispatcher> {
  const db = new Client({
    connectionString: databaseUrl(),
    application_name: "agentranking-cache-invalidation",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  const redis = createClient({
    RESP: 3,
    url: valkeyUrl(),
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1_000,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy(retries) {
        return Math.min(100 * 2 ** Math.min(retries, 5), 2_000);
      },
    },
  });
  const cacheRedis: CacheInvalidationRedis = {
    sendCommand: (command) => redis.sendCommand(command),
    del: (keys) => redis.del(keys),
  };
  redis.on("error", (error) => console.error("[cache-invalidation] Valkey error", error));

  const startupResults = await Promise.allSettled([db.connect(), redis.connect()]);
  const startupErrors = startupResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (startupErrors.length > 0) {
    const cleanupResults = await Promise.allSettled([
      db.end(),
      redis.isOpen ? redis.quit() : Promise.resolve(),
    ]);
    const cleanupErrors = cleanupResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    throw new AggregateError(
      [...startupErrors, ...cleanupErrors],
      "cache invalidation dispatcher startup failed",
    );
  }

  let closed = false;
  let drainPromise: Promise<void> | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let ownsDispatchLock = false;
  let nextDispatchLockAttemptAt = 0;

  const fatal = (error: unknown): void => {
    console.error("[cache-invalidation] dispatch failed", error);
    if (!closed) setImmediate(() => { throw error; });
  };

  const scheduleRetry = (delayMs = RETRY_DELAY_MS): void => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void drain().catch(fatal);
    }, delayMs);
    retryTimer.unref();
  };

  const recoverDrainFailure = (error: unknown): boolean => {
    const classification = classifyDatabaseError(error);
    if (
      classification !== "deadlock"
      && classification !== "serialization_failure"
      && classification !== "lock_timeout"
      && classification !== "statement_timeout"
    ) {
      return false;
    }
    console.warn("[cache-invalidation] transient PostgreSQL concurrency failure; retrying", {
      classification,
    });
    scheduleRetry(CONCURRENCY_RETRY_DELAY_MS);
    return true;
  };

  const ensureDispatchOwnership = async (): Promise<boolean> => {
    if (ownsDispatchLock) return true;
    const now = Date.now();
    if (now < nextDispatchLockAttemptAt) return false;
    const result = await db.query<{ acquired: boolean }>(`
      SELECT pg_try_advisory_lock(hashtextextended($1::text, 0)) AS acquired
    `, [DISPATCH_LOCK_KEY]);
    ownsDispatchLock = result.rows[0]?.acquired === true;
    if (!ownsDispatchLock) nextDispatchLockAttemptAt = now + RETRY_DELAY_MS;
    return ownsDispatchLock;
  };

  const drain = async (): Promise<void> => {
    if (closed) return;
    if (drainPromise) return drainPromise;
    let continueDispatch = false;
    let continueCleanup = false;
    drainPromise = (async () => {
      if (!await ensureDispatchOwnership()) {
        scheduleRetry();
        return;
      }
      let dispatched = 0;
      for (;;) {
        if (closed) break;
        const derivedOpen = await isBootstrapPhaseOpen("DERIVED");
        const result = await db.query<PendingRow>(derivedOpen ? `
          SELECT
            id::text,
            domain,
            revision::text,
            'cache_domain_revisions'::regclass::oid::text AS database_epoch
          FROM cache_invalidation_outbox
          WHERE delivered_at IS NULL
          ORDER BY id ASC
          LIMIT $1
        ` : `
          SELECT
            id::text,
            domain,
            revision::text,
            'cache_domain_revisions'::regclass::oid::text AS database_epoch
          FROM cache_invalidation_outbox
          WHERE delivered_at IS NULL
            AND domain NOT LIKE 'derived:agent-score:%'
          ORDER BY id ASC
          LIMIT $1
        `, [BATCH_SIZE]);
        if (closed) break;
        if (result.rows.length === 0) {
          if (!derivedOpen) {
            const pendingScores = await db.query(`
              SELECT 1
              FROM cache_invalidation_outbox
              WHERE delivered_at IS NULL
                AND domain LIKE 'derived:agent-score:%'
              LIMIT 1
            `);
            if ((pendingScores.rowCount ?? 0) > 0) scheduleRetry();
          }
          break;
        }
        let revisionRaced = false;
        const databaseEpoch = result.rows[0]!.database_epoch;
        if (!/^\d+$/.test(databaseEpoch) || result.rows.some((row) => row.database_epoch !== databaseEpoch)) {
          throw new Error("Unable to resolve a stable cache-domain PostgreSQL relation epoch");
        }
        const batchesByDomain = new Map<string, DomainBatch>();
        for (const row of result.rows) {
          const revision = BigInt(row.revision);
          const existing = batchesByDomain.get(row.domain);
          if (existing) {
            existing.rows.push(row);
            if (revision > existing.revision) existing.revision = revision;
          } else {
            batchesByDomain.set(row.domain, {
              domain: row.domain,
              revision,
              rows: [row],
            });
          }
        }
        const scoreBatches: Array<DomainBatch & { agentId: number }> = [];
        const ordinaryBatches: DomainBatch[] = [];
        for (const batch of batchesByDomain.values()) {
          const agentId = scoreAgentId(batch.domain);
          if (agentId == null) ordinaryBatches.push(batch);
          else scoreBatches.push({ ...batch, agentId });
        }
        const deliveredRows: PendingRow[] = [];
        if (scoreBatches.length > 0) {
          if (derivedOpen) {
            await enqueueScoreRecalculationBatch(scoreBatches.map(({ agentId }) => agentId));
            deliveredRows.push(...scoreBatches.flatMap(({ rows }) => rows));
          }
        }
        const simpleBatches = ordinaryBatches.filter((batch) =>
          batch.domain !== "derived:global-ranks" && !isGenerationDomain(batch.domain),
        );
        const generationBatches = ordinaryBatches.filter((batch) =>
          isGenerationDomain(batch.domain),
        );
        const globalRankBatches = ordinaryBatches.filter((batch) =>
          batch.domain === "derived:global-ranks",
        );
        if (simpleBatches.length > 0) {
          await cacheRedis.del(simpleBatches.flatMap((batch) => [
            `${SHARED_PREFIX}${batch.domain}`,
            `${LEASE_PREFIX}${batch.domain}`,
          ]));
          deliveredRows.push(...simpleBatches.flatMap(({ rows }) => rows));
        }
        await applyGenerationDomains(cacheRedis, generationBatches, databaseEpoch);
        deliveredRows.push(...generationBatches.flatMap(({ rows }) => rows));
        for (const batch of globalRankBatches) {
          await enqueueGlobalRankProjection(batch.revision);
          deliveredRows.push(...batch.rows);
        }
        if (deliveredRows.length > 0) {
          const marked = await db.query(`
            WITH requested(id, revision) AS (
              SELECT *
              FROM unnest($1::bigint[], $2::bigint[])
            ), locked AS MATERIALIZED (
              SELECT outbox.id, outbox.revision
              FROM cache_invalidation_outbox AS outbox
              INNER JOIN requested
                ON requested.id = outbox.id
                AND requested.revision = outbox.revision
              WHERE outbox.delivered_at IS NULL
                AND 'cache_domain_revisions'::regclass::oid::text = $3
              ORDER BY outbox.id ASC
              FOR UPDATE OF outbox SKIP LOCKED
            )
            UPDATE cache_invalidation_outbox AS outbox
            SET delivered_at = now()
            FROM locked
            WHERE outbox.id = locked.id
              AND outbox.revision = locked.revision
          `, [
            deliveredRows.map((row) => row.id),
            deliveredRows.map((row) => row.revision),
            databaseEpoch,
          ]);
          if (marked.rowCount !== deliveredRows.length) revisionRaced = true;
        }
        dispatched += result.rows.length;
        if (closed) break;
        if (revisionRaced) {
          // A writer either advanced the revision after this batch was read or
          // still owns the row lock. Side effects above are intentionally
          // idempotent, so leave the row pending and retry after yielding.
          continueDispatch = true;
          break;
        }
        if (dispatched >= DISPATCH_MAX_ROWS_PER_DRAIN) {
          continueDispatch = true;
          break;
        }
        if (!derivedOpen && result.rows.length < BATCH_SIZE) {
          const pendingScores = await db.query(`
            SELECT 1
            FROM cache_invalidation_outbox
            WHERE delivered_at IS NULL
              AND domain LIKE 'derived:agent-score:%'
            LIMIT 1
          `);
          if ((pendingScores.rowCount ?? 0) > 0) scheduleRetry();
          break;
        }
        if (result.rows.length < BATCH_SIZE) break;
      }
      if (closed || continueDispatch) return;
      let cleaned = 0;
      while (!closed && cleaned < CLEANUP_MAX_ROWS_PER_DRAIN) {
        const cleanup = await db.query(`
          WITH expired AS (
            SELECT id
            FROM cache_invalidation_outbox
            WHERE delivered_at < now() - ($1::text || ' days')::interval
            ORDER BY delivered_at ASC, id ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM cache_invalidation_outbox o
          USING expired
          WHERE o.id = expired.id
        `, [DELIVERED_RETENTION_DAYS, CLEANUP_BATCH_SIZE]);
        const deleted = cleanup.rowCount ?? 0;
        cleaned += deleted;
        if (deleted < CLEANUP_BATCH_SIZE) break;
      }
      // Retention is not latency-sensitive. Continue a large historical purge
      // on the retry cadence instead of coupling a 100k-row delete burst to the
      // foreground invalidation drain that just became idle.
      continueCleanup = cleaned >= CLEANUP_MAX_ROWS_PER_DRAIN;
    })().catch((error: unknown) => {
      if (!recoverDrainFailure(error)) throw error;
    }).finally(() => {
      drainPromise = null;
      if (continueDispatch) scheduleRetry(DISPATCH_CONTINUATION_DELAY_MS);
      else if (continueCleanup) scheduleRetry();
    });
    return drainPromise;
  };

  db.on("notification", () => {
    // LISTEN can coalesce a large write burst into many callbacks while one
    // drain is in flight. Attach at most one fatal handler to that drain;
    // otherwise a single rejected promise is re-thrown once per notification.
    if (!drainPromise) void drain().catch(fatal);
  });
  db.on("error", (error) => {
    console.error("[cache-invalidation] PostgreSQL listener error", error);
    if (!closed) setImmediate(() => { throw error; });
  });
  await db.query(`LISTEN ${CHANNEL}`);
  await drain();
  console.info("[cache-invalidation] durable dispatcher started; initial backlog quantum applied");

  return {
    async close() {
      if (closed) return;
      closed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const closeErrors: unknown[] = [];
      if (drainPromise) {
        try {
          await drainPromise;
        } catch (error) {
          closeErrors.push(error);
        }
      }
      const closing: Array<Promise<unknown>> = [
        (async () => {
          const databaseErrors: unknown[] = [];
          try {
            await db.query(`UNLISTEN ${CHANNEL}`);
          } catch (error) {
            databaseErrors.push(error);
          }
          try {
            await db.end();
          } catch (error) {
            databaseErrors.push(error);
          }
          if (databaseErrors.length === 1) throw databaseErrors[0];
          if (databaseErrors.length > 1) {
            throw new AggregateError(databaseErrors, "cache invalidation PostgreSQL shutdown failed");
          }
        })(),
        redis.isOpen ? redis.quit() : Promise.resolve(),
      ];
      const closeResults = await Promise.allSettled(closing);
      closeErrors.push(
        ...closeResults.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        ),
      );
      if (closeErrors.length === 1) throw closeErrors[0];
      if (closeErrors.length > 1) {
        throw new AggregateError(closeErrors, "cache invalidation dispatcher shutdown failed");
      }
    },
  };
}
