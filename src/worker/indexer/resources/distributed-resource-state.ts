import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db.js";
import type { AdaptiveFailureKind } from "./adaptive-capacity.js";
import type { ResourceKey } from "./resource-key.js";
import type { ResourceProfile } from "./resource-profile.js";
export type DistributedResourceAvailability = {
  capacity: number;
  waitMs: number;
  latencyEwmaMs: number;
  rateLimitedUntil: Date | null;
  coolingUntil: Date | null;
};
type StateRow = {
  capacity: number;
  latency_ewma_ms: number;
  rate_limited_until: Date | null;
  cooling_until: Date | null;
  wait_ms: bigint | number | string | null;
};
const SUCCESS_COALESCE_MS = 10;
type PendingSuccessBatch = {
  count: number;
  latencyDecay: number;
  latencyContribution: number;
  initialLatencyEwma: number;
  flushing: boolean;
  promise: Promise<DistributedResourceAvailability | null>;
  resolve(value: DistributedResourceAvailability | null): void;
  reject(error: unknown): void;
};
const pendingSuccessBatches = new Map<ResourceKey, PendingSuccessBatch>();
// Slot claims re-check the authoritative shared state in SQL, so this cache
// only controls admission hints. A one-second window removes a per-RPC state
// read at high throughput without weakening the distributed capacity fence.
const AVAILABILITY_CACHE_MS = 1_000;
const PROFILE_RECONCILE_MS = 60_000;
const availabilityCache = new Map<ResourceKey, {
  fingerprint: string;
  expiresAt: number;
  value: DistributedResourceAvailability;
}>();
const availabilityLoads = new Map<string, Promise<DistributedResourceAvailability>>();
const reconciledProfiles = new Map<ResourceKey, { fingerprint: string; expiresAt: number }>();
function retainObservedAvailability(
  resourceKey: ResourceKey,
  value: DistributedResourceAvailability,
): void {
  const cached = availabilityCache.get(resourceKey);
  if (!cached) return;
  availabilityCache.set(resourceKey, {
    fingerprint: cached.fingerprint,
    expiresAt: Date.now() + AVAILABILITY_CACHE_MS,
    value,
  });
}
function profileFingerprint(profile: ResourceProfile): string {
  return [
    profile.maxCapacity,
    profile.minCapacity,
    profile.successWindow,
    profile.decreaseFactor,
  ].join(":");
}
function parseWaitMs(value: StateRow["wait_ms"]): number {
  const parsed = value == null ? 0 : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 0;
}
function toAvailability(row: StateRow): DistributedResourceAvailability {
  return {
    capacity: row.capacity,
    waitMs: parseWaitMs(row.wait_ms),
    latencyEwmaMs: Number.isFinite(row.latency_ewma_ms) ? row.latency_ewma_ms : 0,
    rateLimitedUntil: row.rate_limited_until,
    coolingUntil: row.cooling_until,
  };
}
async function readResourceAvailability(resourceKey: ResourceKey): Promise<StateRow | null> {
  const rows = await prisma.$queryRaw<StateRow[]>(Prisma.sql`SELECT
       "capacity", "latency_ewma_ms", "rate_limited_until", "cooling_until",
       GREATEST(
         0,
         CEIL(EXTRACT(EPOCH FROM (
           GREATEST(
             COALESCE("rate_limited_until", '-infinity'::timestamptz),
             COALESCE("cooling_until", '-infinity'::timestamptz)
           ) - CURRENT_TIMESTAMP
         )) * 1000)
       )::bigint AS "wait_ms"
     FROM "worker_resource_states"
     WHERE "resource_key" = ${resourceKey}::text`);
  return rows[0] ?? null;
}
/** Creates or reconciles the shared AIMD contract and returns DB-clock availability. */
async function loadDistributedResourceAvailability(
  resourceKey: ResourceKey,
  profile: ResourceProfile,
): Promise<DistributedResourceAvailability> {
  const fingerprint = profileFingerprint(profile);
  const reconciled = reconciledProfiles.get(resourceKey);
  if (reconciled?.fingerprint === fingerprint && reconciled.expiresAt > Date.now()) {
    const current = await readResourceAvailability(resourceKey);
    if (current) return toAvailability(current);
    reconciledProfiles.delete(resourceKey);
  }
  const rows = await prisma.$queryRaw<StateRow[]>(Prisma.sql`WITH ensured AS (
       INSERT INTO "worker_resource_states" (
         "resource_key", "capacity", "min_capacity", "max_capacity",
         "success_window_target", "success_count", "failure_streak",
         "decrease_factor", "latency_ewma_ms", "updated_at"
       ) VALUES (${resourceKey}::text, ${profile.maxCapacity}::integer, ${profile.minCapacity}::integer, ${profile.maxCapacity}::integer, ${profile.successWindow}::integer, 0, 0, ${profile.decreaseFactor}::double precision, 0, CURRENT_TIMESTAMP)
       ON CONFLICT ("resource_key") DO UPDATE
         SET "min_capacity" = EXCLUDED."min_capacity",
             "max_capacity" = EXCLUDED."max_capacity",
             "capacity" = LEAST(EXCLUDED."max_capacity", GREATEST(EXCLUDED."min_capacity", "worker_resource_states"."capacity")),
             "success_window_target" = EXCLUDED."success_window_target",
             "success_count" = LEAST("worker_resource_states"."success_count", EXCLUDED."success_window_target" - 1),
             "decrease_factor" = EXCLUDED."decrease_factor",
             "updated_at" = CURRENT_TIMESTAMP
       WHERE "worker_resource_states"."min_capacity" <> EXCLUDED."min_capacity"
          OR "worker_resource_states"."max_capacity" <> EXCLUDED."max_capacity"
          OR "worker_resource_states"."success_window_target" <> EXCLUDED."success_window_target"
          OR "worker_resource_states"."decrease_factor" <> EXCLUDED."decrease_factor"
          OR "worker_resource_states"."capacity" < EXCLUDED."min_capacity"
          OR "worker_resource_states"."capacity" > EXCLUDED."max_capacity"
       RETURNING "capacity", "latency_ewma_ms", "rate_limited_until", "cooling_until"
     ), current_state AS (
       SELECT "capacity", "latency_ewma_ms", "rate_limited_until", "cooling_until"
       FROM ensured
       UNION ALL
       SELECT "capacity", "latency_ewma_ms", "rate_limited_until", "cooling_until"
       FROM "worker_resource_states"
       WHERE "resource_key" = ${resourceKey}::text AND NOT EXISTS (SELECT 1 FROM ensured)
       LIMIT 1
     )
     SELECT
       "capacity", "latency_ewma_ms", "rate_limited_until", "cooling_until",
       GREATEST(
         0,
         CEIL(EXTRACT(EPOCH FROM (
           GREATEST(
             COALESCE("rate_limited_until", '-infinity'::timestamptz),
             COALESCE("cooling_until", '-infinity'::timestamptz)
           ) - CURRENT_TIMESTAMP
         )) * 1000)
       )::bigint AS "wait_ms"
     FROM current_state`);
  let row: StateRow | null = rows[0] ?? null;
  if (!row) {
    // An INSERT/ON CONFLICT statement can observe a concurrent conflicting row before that row is
    // visible to its original statement snapshot. A new statement sees the committed state.
    row = await readResourceAvailability(resourceKey);
  }
  if (!row) throw new Error(`Failed to create or read distributed resource state for ${resourceKey}`);
  reconciledProfiles.set(resourceKey, {
    fingerprint,
    expiresAt: Date.now() + PROFILE_RECONCILE_MS,
  });
  return toAvailability(row);
}
export function distributedResourceAvailability(
  resourceKey: ResourceKey,
  profile: ResourceProfile,
): Promise<DistributedResourceAvailability> {
  const fingerprint = profileFingerprint(profile);
  const cached = availabilityCache.get(resourceKey);
  if (cached?.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value);
  }
  const loadKey = `${resourceKey}\u0000${fingerprint}`;
  const existing = availabilityLoads.get(loadKey);
  if (existing) return existing;
  const pending = loadDistributedResourceAvailability(resourceKey, profile)
    .then((value) => {
      availabilityCache.set(resourceKey, {
        fingerprint,
        expiresAt: Date.now() + AVAILABILITY_CACHE_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      if (availabilityLoads.get(loadKey) === pending) availabilityLoads.delete(loadKey);
    });
  availabilityLoads.set(loadKey, pending);
  return pending;
}
async function flushDistributedResourceSuccess(
  resourceKey: ResourceKey,
  batch: PendingSuccessBatch,
): Promise<DistributedResourceAvailability | null> {
  const rows = await prisma.$queryRaw<StateRow[]>(Prisma.sql`UPDATE "worker_resource_states"
        SET "latency_ewma_ms" = CASE
              WHEN "latency_ewma_ms" <= 0 THEN ${batch.initialLatencyEwma}::double precision
              ELSE "latency_ewma_ms" * ${batch.latencyDecay}::double precision + ${batch.latencyContribution}::double precision
            END,
            "failure_streak" = 0,
            "capacity" = CASE
              WHEN COALESCE("rate_limited_until", '-infinity'::timestamptz) <= CURRENT_TIMESTAMP
               AND COALESCE("cooling_until", '-infinity'::timestamptz) <= CURRENT_TIMESTAMP
              THEN LEAST(
                "max_capacity",
                "capacity" + (
                  ("success_count" + ${batch.count}::integer) /
                  GREATEST(1, "success_window_target")
                )
              )
              ELSE "capacity"
            END,
            "success_count" = CASE
              WHEN COALESCE("rate_limited_until", '-infinity'::timestamptz) <= CURRENT_TIMESTAMP
               AND COALESCE("cooling_until", '-infinity'::timestamptz) <= CURRENT_TIMESTAMP
              THEN ("success_count" + ${batch.count}::integer) % GREATEST(1, "success_window_target")
              ELSE "success_count"
            END,
            "rate_limited_until" = CASE
              WHEN "rate_limited_until" <= CURRENT_TIMESTAMP THEN NULL
              ELSE "rate_limited_until"
            END,
            "cooling_until" = CASE
              WHEN "cooling_until" <= CURRENT_TIMESTAMP THEN NULL
              ELSE "cooling_until"
            END,
            "updated_at" = CURRENT_TIMESTAMP
      WHERE "resource_key" = ${resourceKey}::text
      RETURNING
        "capacity", "latency_ewma_ms", "rate_limited_until", "cooling_until",
        GREATEST(
          0,
          CEIL(EXTRACT(EPOCH FROM (
            GREATEST(
              COALESCE("rate_limited_until", '-infinity'::timestamptz),
              COALESCE("cooling_until", '-infinity'::timestamptz)
            ) - CURRENT_TIMESTAMP
          )) * 1000)
        )::bigint AS "wait_ms"`);
  if (!rows[0]) return null;
  const availability = toAvailability(rows[0]);
  retainObservedAvailability(resourceKey, availability);
  return availability;
}

function startDistributedResourceSuccessFlush(
  resourceKey: ResourceKey,
  batch: PendingSuccessBatch,
): Promise<DistributedResourceAvailability | null> {
  if (batch.flushing) return batch.promise;
  batch.flushing = true;
  if (pendingSuccessBatches.get(resourceKey) === batch) {
    pendingSuccessBatches.delete(resourceKey);
  }
  void flushDistributedResourceSuccess(resourceKey, batch).then(batch.resolve, batch.reject);
  return batch.promise;
}

/** Coalesces concurrent successes while preserving exact additive-increase counts. */
export function recordDistributedResourceSuccess(
  resourceKey: ResourceKey,
  elapsedMs: number,
): Promise<DistributedResourceAvailability | null> {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return Promise.resolve(null);
  let batch = pendingSuccessBatches.get(resourceKey);
  if (!batch) {
    let resolve!: PendingSuccessBatch["resolve"];
    let reject!: PendingSuccessBatch["reject"];
    const promise = new Promise<DistributedResourceAvailability | null>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    batch = {
      count: 0,
      latencyDecay: 1,
      latencyContribution: 0,
      initialLatencyEwma: elapsedMs,
      flushing: false,
      promise,
      resolve,
      reject,
    };
    pendingSuccessBatches.set(resourceKey, batch);
    const pending = batch;
    setTimeout(() => {
      void startDistributedResourceSuccessFlush(resourceKey, pending);
    }, SUCCESS_COALESCE_MS);
  }
  batch.count += 1;
  batch.latencyDecay *= 0.8;
  batch.latencyContribution = batch.latencyContribution * 0.8 + elapsedMs * 0.2;
  if (batch.count === 1) batch.initialLatencyEwma = elapsedMs;
  else batch.initialLatencyEwma = batch.initialLatencyEwma * 0.8 + elapsedMs * 0.2;
  return batch.promise;
}
/** Records one shared multiplicative decrease and provider-wide cooldown. */
export async function recordDistributedResourceFailure(
  resourceKey: ResourceKey,
  kind: AdaptiveFailureKind,
  retryAfterMs?: number,
): Promise<DistributedResourceAvailability | null> {
  if (kind === "fatal") return null;
  // Preserve success-before-failure ordering within this process. Otherwise a
  // delayed success batch could clear the failure streak after this decrease.
  const pendingSuccess = pendingSuccessBatches.get(resourceKey);
  if (pendingSuccess) {
    await startDistributedResourceSuccessFlush(resourceKey, pendingSuccess);
  }
  const explicitRetry = retryAfterMs && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.ceil(retryAfterMs)
    : null;
  const baseMs = kind === "rate_limit" ? 5_000 : 750;
  const rows = await prisma.$queryRaw<StateRow[]>(Prisma.sql`UPDATE "worker_resource_states"
        SET "success_count" = 0,
            "failure_streak" = "failure_streak" + 1,
            "capacity" = GREATEST(
              "min_capacity",
              FLOOR("capacity"::double precision * "decrease_factor")::integer
            ),
            "rate_limited_until" = CASE WHEN ${kind}::text = 'rate_limit' THEN
              GREATEST(
                COALESCE("rate_limited_until", '-infinity'::timestamptz),
                CURRENT_TIMESTAMP + (
                  COALESCE(
                    ${explicitRetry}::bigint,
                    LEAST(
                      120000::double precision,
                      GREATEST(
                        250::double precision,
                        ${baseMs}::double precision * POWER(2::double precision, LEAST(7, GREATEST(0, "failure_streak")))
                      )
                    )::bigint
                  )::double precision * INTERVAL '1 millisecond'
                )
              )
              ELSE "rate_limited_until"
            END,
            "cooling_until" = CASE WHEN ${kind}::text = 'transient' THEN
              GREATEST(
                COALESCE("cooling_until", '-infinity'::timestamptz),
                CURRENT_TIMESTAMP + (
                  LEAST(
                    120000::double precision,
                    GREATEST(
                      250::double precision,
                      ${baseMs}::double precision * POWER(2::double precision, LEAST(7, GREATEST(0, "failure_streak")))
                    )
                  ) * INTERVAL '1 millisecond'
                )
              )
              ELSE "cooling_until"
            END,
            "updated_at" = CURRENT_TIMESTAMP
      WHERE "resource_key" = ${resourceKey}::text
      RETURNING
        "capacity", "latency_ewma_ms", "rate_limited_until", "cooling_until",
        GREATEST(
          0,
          CEIL(EXTRACT(EPOCH FROM (
            GREATEST(
              COALESCE("rate_limited_until", '-infinity'::timestamptz),
              COALESCE("cooling_until", '-infinity'::timestamptz)
            ) - CURRENT_TIMESTAMP
          )) * 1000)
        )::bigint AS "wait_ms"`);
  if (!rows[0]) return null;
  const availability = toAvailability(rows[0]);
  retainObservedAvailability(resourceKey, availability);
  return availability;
}
