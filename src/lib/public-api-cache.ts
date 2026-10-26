import "server-only";
import { randomUUID } from "node:crypto";
import { Counter, Gauge, Histogram } from "prom-client";
import { stringifyJsonCompatible, toJsonCompatible } from "@/lib/json-compatible";
import {
  isPublicApiCacheEnvelope,
  type CacheEnvelope,
  type PublicApiCacheOptions,
  type PublicApiCacheResult,
  type PublicApiCacheStatus,
} from "@/lib/public-api-cache-primitives";
import {
  releaseValkeyLease,
  renewValkeyLease,
  tryAcquireValkeyLease,
  valkeyDeleteKeys,
  valkeyEval,
  isValkeyMemoryStore,
  valkeyMemoryUpdate,
  valkeyGetJson,
  valkeySetJsonIfLeaseOwner,
} from "@/lib/valkey";

export {
  canonicalPublicApiQuery,
  publicApiCacheKey,
  type CacheEnvelope,
  type CachePolicy,
  type PublicApiCacheOptions,
  type PublicApiCacheResult,
  type PublicApiCacheStatus,
} from "@/lib/public-api-cache-primitives";

const SHARED_PREFIX = "public-api:v1:";
const LEASE_PREFIX = "public-api-lock:v1:";
const GENERATION_PREFIX = "public-api-generation:";
const DEFAULT_MAX_PAYLOAD_BYTES = 1_048_576;
const HEALTH_WINDOW_MS = 5 * 60 * 1_000;

const GENERATION_MAX_LUA = `
redis.setresp(3)
local raw = redis.call('GET', KEYS[1])
local current = tonumber(raw)
local candidate = tonumber(ARGV[1])
if candidate == nil or candidate < 0 then
  return redis.error_reply('invalid generation candidate')
end
if current == nil or current < 0 or candidate > current then
  redis.call('SET', KEYS[1], tostring(candidate))
  return candidate
end
return current
`;

const GENERATION_ADVANCE_LUA = `
redis.setresp(3)
local raw = redis.call('GET', KEYS[1])
local current = tonumber(raw)
local candidate = tonumber(ARGV[1])
if candidate == nil or candidate < 0 then
  return redis.error_reply('invalid generation candidate')
end
if current == nil or current < 0 then
  current = 0
end
local next = candidate
if next <= current then
  next = current + 1
end
redis.call('SET', KEYS[1], tostring(next))
return next
`;

export type PublicApiCacheTestBackend = {
  getJson: (key: string) => Promise<unknown | null>;
  deleteKeys: (keys: string[]) => Promise<number>;
  tryAcquireLease: (input: { key: string; token: string; ttlMs: number }) => Promise<boolean>;
  renewLease: (input: { key: string; token: string; ttlMs: number }) => Promise<boolean>;
  releaseLease: (input: { key: string; token: string }) => Promise<boolean>;
  publishJsonIfLeaseOwner: (input: {
    key: string;
    leaseKey: string;
    token: string;
    value: unknown;
    ttlSeconds: number;
  }) => Promise<boolean>;
  reconcileGeneration: (input: {
    key: string;
    candidate: number;
    advance: boolean;
  }) => Promise<number>;
};

const defaultBackend: PublicApiCacheTestBackend = {
  getJson: (key) => valkeyGetJson<unknown>(key),
  deleteKeys: (keys) => valkeyDeleteKeys(keys),
  tryAcquireLease: tryAcquireValkeyLease,
  renewLease: renewValkeyLease,
  releaseLease: releaseValkeyLease,
  publishJsonIfLeaseOwner: valkeySetJsonIfLeaseOwner,
  async reconcileGeneration(input) {
    if (isValkeyMemoryStore()) {
      // Same rules as GENERATION_ADVANCE_LUA and GENERATION_MAX_LUA.
      return Number(valkeyMemoryUpdate(input.key, (raw) => {
        const current = raw === null ? Number.NaN : Number(raw);
        if (Number.isNaN(current) || current < 0) return String(input.candidate);
        if (input.advance) return String(input.candidate <= current ? current + 1 : input.candidate);
        return String(Math.max(current, input.candidate));
      }));
    }
    const result = await valkeyEval({
      script: input.advance ? GENERATION_ADVANCE_LUA : GENERATION_MAX_LUA,
      keys: [input.key],
      args: [String(input.candidate)],
    });
    const generation = Number(result);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new TypeError(`Invalid cache generation returned for ${input.key}`);
    }
    return generation;
  },
};

let backend: PublicApiCacheTestBackend = defaultBackend;

export class PublicApiCacheCoordinationError extends Error {
  readonly retryAfterSeconds = 5;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PublicApiCacheCoordinationError";
  }
}

type PublicCacheMetrics = {
  requests: Counter<"namespace" | "status">;
  loadDuration: Histogram<"namespace" | "outcome">;
  payloadBytes: Gauge<"namespace">;
  leaseWait: Histogram<"namespace">;
  leaseContention: Counter<"namespace">;
  validationFailures: Counter<"namespace">;
  staleServed: Counter<"namespace" | "reason">;
};

type PublicCacheHealthWindow = {
  startedAt: number;
  requests: number;
  leaseContentions: number;
  validationFailures: number;
  staleServed: number;
};

export type PublicApiCacheHealth = {
  store: "valkey";
  inFlightLoads: number;
  windowStartedAt: string;
  windowSeconds: number;
  recentRequests: number;
  recentLeaseContentions: number;
  recentValidationFailures: number;
  recentStaleServed: number;
  leaseContentionRate: number;
};

const globalForPublicApiCache = globalThis as typeof globalThis & {
  __agentRankingPublicApiInFlight?: Map<string, Promise<PublicApiCacheResult<unknown>>>;
  __agentRankingPublicApiActiveLoads?: Map<string, number>;
  __agentRankingPublicApiKeyInvalidationEpochs?: Map<string, number>;
  __agentRankingPublicApiHealthWindow?: PublicCacheHealthWindow;
  __agentRankingPublicApiMetrics?: PublicCacheMetrics;
};

const inFlight = (globalForPublicApiCache.__agentRankingPublicApiInFlight ??= new Map());
const activeLoads = (globalForPublicApiCache.__agentRankingPublicApiActiveLoads ??= new Map());
const keyInvalidationEpochs = (
  globalForPublicApiCache.__agentRankingPublicApiKeyInvalidationEpochs ??= new Map()
);

/** @internal Test-only dependency injection for deterministic cache/lease behavior. */
export function setPublicApiCacheBackendForTests(next: PublicApiCacheTestBackend | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Public API cache backend injection is only available in tests");
  }
  backend = next ?? defaultBackend;
}

/** @internal Clear process-local request-coordination state between tests. */
export function resetPublicApiCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Public API cache reset is only available in tests");
  }
  inFlight.clear();
  activeLoads.clear();
  keyInvalidationEpochs.clear();
  delete globalForPublicApiCache.__agentRankingPublicApiHealthWindow;
}

function metrics(): PublicCacheMetrics {
  return (globalForPublicApiCache.__agentRankingPublicApiMetrics ??= {
    requests: new Counter({
      name: "public_cache_requests_total",
      help: "Public API cache requests by logical namespace and result status.",
      labelNames: ["namespace", "status"],
    }),
    loadDuration: new Histogram({
      name: "public_cache_load_duration_seconds",
      help: "Public API origin load duration.",
      labelNames: ["namespace", "outcome"],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    }),
    payloadBytes: new Gauge({
      name: "public_cache_payload_bytes",
      help: "Serialized public API payload bytes for the latest origin write.",
      labelNames: ["namespace"],
    }),
    leaseWait: new Histogram({
      name: "public_cache_lease_wait_seconds",
      help: "Time spent waiting for another process to publish a public API cache entry.",
      labelNames: ["namespace"],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40, 60],
    }),
    leaseContention: new Counter({
      name: "public_cache_lease_contention_total",
      help: "Public API refresh lease acquisition contention.",
      labelNames: ["namespace"],
    }),
    validationFailures: new Counter({
      name: "public_cache_validation_failures_total",
      help: "Rejected public API cache envelopes or loader payloads.",
      labelNames: ["namespace"],
    }),
    staleServed: new Counter({
      name: "public_cache_stale_served_total",
      help: "Stale public API cache responses by reason.",
      labelNames: ["namespace", "reason"],
    }),
  });
}

function healthWindow(now = Date.now()): PublicCacheHealthWindow {
  const current = globalForPublicApiCache.__agentRankingPublicApiHealthWindow;
  if (current && now - current.startedAt < HEALTH_WINDOW_MS) return current;
  const next: PublicCacheHealthWindow = {
    startedAt: now,
    requests: 0,
    leaseContentions: 0,
    validationFailures: 0,
    staleServed: 0,
  };
  globalForPublicApiCache.__agentRankingPublicApiHealthWindow = next;
  return next;
}

function recordRequest(): void {
  healthWindow().requests += 1;
}

function recordLeaseContention(namespace: string): void {
  metrics().leaseContention.inc({ namespace });
  healthWindow().leaseContentions += 1;
}

function recordValidationFailure(namespace: string): void {
  metrics().validationFailures.inc({ namespace });
  healthWindow().validationFailures += 1;
}

function recordStaleServed(namespace: string, reason: string): void {
  metrics().staleServed.inc({ namespace, reason });
  healthWindow().staleServed += 1;
}

function serializedPayloadBytes(value: unknown): number {
  return Buffer.byteLength(stringifyJsonCompatible(value), "utf8");
}

function logCacheEvent(input: {
  namespace: string;
  cacheStatus: "origin" | "stale";
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  loadDurationMs: number;
  payloadBytes: number;
  leaseContended: boolean;
  servedStale: boolean;
}): void {
  console.info("[public-api-cache]", input);
}

function logicalNamespace(key: string): string {
  const base = key.split("?", 1)[0] || "unknown";
  return base.replace(/:g\d+$/, "").slice(0, 80);
}

function assertOptions<T>(options: PublicApiCacheOptions<T>): void {
  if (!options.key.trim()) throw new TypeError("Public API cache key must not be empty");
  if (!Number.isInteger(options.freshTtlSeconds) || options.freshTtlSeconds <= 0) {
    throw new TypeError("freshTtlSeconds must be a positive integer");
  }
  if (!Number.isInteger(options.staleTtlSeconds) || options.staleTtlSeconds < options.freshTtlSeconds) {
    throw new TypeError("staleTtlSeconds must be an integer greater than or equal to freshTtlSeconds");
  }
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes <= 0) {
    throw new TypeError("maxPayloadBytes must be a positive integer");
  }
}

function generationKey(namespace: string): string {
  return `${GENERATION_PREFIX}${namespace}`;
}

function assertNamespace(namespace: string): void {
  if (!namespace.trim() || namespace.includes("?")) {
    throw new TypeError("Public API cache namespace must be a non-empty query-free string");
  }
}

function keyInvalidationEpoch(key: string): number {
  return keyInvalidationEpochs.get(key) ?? 0;
}

function bumpKeyInvalidationEpoch(key: string): void {
  keyInvalidationEpochs.set(key, keyInvalidationEpoch(key) + 1);
}

function beginActiveLoad(key: string): void {
  activeLoads.set(key, (activeLoads.get(key) ?? 0) + 1);
}

function finishActiveLoad(key: string): void {
  const remaining = (activeLoads.get(key) ?? 1) - 1;
  if (remaining > 0) {
    activeLoads.set(key, remaining);
    return;
  }
  activeLoads.delete(key);
  keyInvalidationEpochs.delete(key);
}

function activeLoadTotal(): number {
  let total = 0;
  for (const count of activeLoads.values()) total += count;
  return total;
}

function sharedKey(logicalKey: string): string {
  return `${SHARED_PREFIX}${logicalKey}`;
}

function leaseKey(logicalKey: string): string {
  return `${LEASE_PREFIX}${logicalKey}`;
}

function isCacheEnvelope<T>(
  value: unknown,
  options: PublicApiCacheOptions<T>,
  maxPayloadBytes: number,
): value is CacheEnvelope<T> {
  return isPublicApiCacheEnvelope(value, {
    validate: options.validate,
    maxPayloadBytes,
    freshTtlSeconds: options.freshTtlSeconds,
    staleTtlSeconds: options.staleTtlSeconds,
  });
}

function cacheResult<T>(
  envelope: CacheEnvelope<T>,
  status: PublicApiCacheStatus,
  namespace: string,
): PublicApiCacheResult<T> {
  metrics().requests.inc({ namespace, status });
  recordRequest();
  return { value: envelope.value, generatedAt: envelope.generatedAt, status };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPublication<T>(input: {
  key: string;
  options: PublicApiCacheOptions<T>;
  maxPayloadBytes: number;
  waitMs: number;
  namespace: string;
}): Promise<{ fresh: CacheEnvelope<T> | null; stale: CacheEnvelope<T> | null }> {
  const startedAt = Date.now();
  const deadline = startedAt + input.waitMs;
  let stale: CacheEnvelope<T> | null = null;

  while (Date.now() < deadline) {
    await sleep(100 + Math.floor(Math.random() * 151));
    const raw = await backend.getJson(input.key);
    if (raw == null) continue;
    if (!isCacheEnvelope(raw, input.options, input.maxPayloadBytes)) {
      recordValidationFailure(input.namespace);
      await backend.deleteKeys([input.key]);
      continue;
    }
    const now = Date.now();
    if (raw.freshUntil > now) {
      metrics().leaseWait.observe({ namespace: input.namespace }, (now - startedAt) / 1_000);
      return { fresh: raw, stale };
    }
    if (raw.staleUntil > now) stale = raw;
  }

  metrics().leaseWait.observe(
    { namespace: input.namespace },
    (Date.now() - startedAt) / 1_000,
  );
  return { fresh: null, stale };
}

async function loadCached<T>(options: PublicApiCacheOptions<T>): Promise<PublicApiCacheResult<T>> {
  assertOptions(options);
  const key = sharedKey(options.key);
  const lockKey = leaseKey(options.key);
  const namespace = logicalNamespace(options.key);
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const leaseTtlMs = Math.max(15_000, Math.min(300_000, options.leaseTtlMs ?? 75_000));
  const leaseWaitMs = Math.max(1_000, Math.min(65_000, options.leaseWaitMs ?? 15_000));
  const loadInvalidationEpoch = keyInvalidationEpoch(key);
  const invalidationUnchanged = () => keyInvalidationEpoch(key) === loadInvalidationEpoch;
  let staleCandidate: CacheEnvelope<T> | null = null;
  let leaseContended = false;

  const cached = await backend.getJson(key);
  if (cached != null) {
    if (!isCacheEnvelope(cached, options, maxPayloadBytes)) {
      recordValidationFailure(namespace);
      await backend.deleteKeys([key]);
    } else if (cached.freshUntil > Date.now() && invalidationUnchanged()) {
      return cacheResult(cached, "shared", namespace);
    } else if (cached.staleUntil > Date.now() && invalidationUnchanged()) {
      staleCandidate = cached;
    }
  }

  const token = randomUUID();
  let ownsLease = await backend.tryAcquireLease({ key: lockKey, token, ttlMs: leaseTtlMs });

  if (!ownsLease) {
    leaseContended = true;
    recordLeaseContention(namespace);
    if (staleCandidate) {
      recordStaleServed(namespace, "lease-contended");
      logCacheEvent({
        namespace,
        cacheStatus: "stale",
        freshTtlSeconds: options.freshTtlSeconds,
        staleTtlSeconds: options.staleTtlSeconds,
        loadDurationMs: 0,
        payloadBytes: serializedPayloadBytes(staleCandidate.value),
        leaseContended: true,
        servedStale: true,
      });
      return cacheResult(staleCandidate, "stale", namespace);
    }

    const published = await waitForPublication({
      key,
      options,
      maxPayloadBytes,
      waitMs: leaseWaitMs,
      namespace,
    });
    if (published.fresh && invalidationUnchanged()) {
      return cacheResult(published.fresh, "shared", namespace);
    }
    if (published.stale && invalidationUnchanged()) staleCandidate = published.stale;

    ownsLease = await backend.tryAcquireLease({ key: lockKey, token, ttlMs: leaseTtlMs });
    if (!ownsLease) {
      if (staleCandidate) {
        recordStaleServed(namespace, "lease-wait-timeout");
        return cacheResult(staleCandidate, "stale", namespace);
      }
      throw new PublicApiCacheCoordinationError(
        `Public API cache refresh is already in progress for ${namespace}`,
      );
    }
  }

  let renewalInFlight = false;
  let leaseFailure: unknown;
  const activeRenewals = new Set<Promise<void>>();
  const heartbeat = setInterval(() => {
    if (renewalInFlight || leaseFailure) return;
    renewalInFlight = true;
    const renewal = backend
      .renewLease({ key: lockKey, token, ttlMs: leaseTtlMs })
      .then((renewed) => {
        if (!renewed) leaseFailure = new Error(`Public API cache lease was lost for ${namespace}`);
      })
      .catch((error: unknown) => {
        leaseFailure = error;
      })
      .finally(() => {
        renewalInFlight = false;
      });
    activeRenewals.add(renewal);
    void renewal.finally(() => activeRenewals.delete(renewal));
  }, Math.max(1_000, Math.floor(leaseTtlMs / 3)));
  heartbeat.unref?.();

  const loadStartedAt = Date.now();
  let loadError: unknown;
  try {
    const loaded = await options.load();
    if (!options.validate(loaded)) {
      recordValidationFailure(namespace);
      throw new TypeError(`Origin payload validation failed for ${namespace}`);
    }
    const value = toJsonCompatible(loaded);
    if (!options.validate(value)) {
      recordValidationFailure(namespace);
      throw new TypeError(`Serialized origin payload validation failed for ${namespace}`);
    }
    const payloadBytes = serializedPayloadBytes(value);
    if (payloadBytes > maxPayloadBytes) {
      recordValidationFailure(namespace);
      throw new RangeError(`Origin payload exceeded ${maxPayloadBytes} bytes for ${namespace}`);
    }
    if (leaseFailure) {
      throw new PublicApiCacheCoordinationError(`Public API cache lease failed for ${namespace}`, {
        cause: leaseFailure,
      });
    }

    const generatedAt = new Date().toISOString();
    const generatedAtMs = Date.parse(generatedAt);
    const envelope: CacheEnvelope<T> = {
      version: 1,
      generatedAt,
      freshUntil: generatedAtMs + options.freshTtlSeconds * 1_000,
      staleUntil: generatedAtMs + options.staleTtlSeconds * 1_000,
      value,
    };
    const cacheable = options.shouldCacheValue?.(value) ?? true;
    if (cacheable) {
      const published = await backend.publishJsonIfLeaseOwner({
        key,
        leaseKey: lockKey,
        token,
        value: envelope,
        ttlSeconds: options.staleTtlSeconds,
      });
      if (!published) {
        throw new PublicApiCacheCoordinationError(`Public API cache lease was lost for ${namespace}`);
      }
      if (!invalidationUnchanged()) await backend.deleteKeys([key]);
    } else {
      await backend.deleteKeys([key]);
    }

    const loadDurationMs = Date.now() - loadStartedAt;
    metrics().payloadBytes.set({ namespace }, payloadBytes);
    metrics().loadDuration.observe({ namespace, outcome: "success" }, loadDurationMs / 1_000);
    logCacheEvent({
      namespace,
      cacheStatus: "origin",
      freshTtlSeconds: options.freshTtlSeconds,
      staleTtlSeconds: options.staleTtlSeconds,
      loadDurationMs,
      payloadBytes,
      leaseContended,
      servedStale: false,
    });
    return cacheResult(envelope, "origin", namespace);
  } catch (error) {
    loadError = error;
    metrics().loadDuration.observe(
      { namespace, outcome: "failure" },
      (Date.now() - loadStartedAt) / 1_000,
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
    const cleanupErrors: unknown[] = [];
    await Promise.all([...activeRenewals]);
    if (leaseFailure && loadError !== leaseFailure) cleanupErrors.push(leaseFailure);
    try {
      const released = await backend.releaseLease({ key: lockKey, token });
      if (!released && !leaseFailure) {
        cleanupErrors.push(new Error(`Public API cache lease was lost for ${namespace}`));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        loadError === undefined ? cleanupErrors : [loadError, ...cleanupErrors],
        `Public API cache cleanup failed for ${namespace}`,
      );
    }
  }
}

export function getPublicApiCached<T>(
  options: PublicApiCacheOptions<T>,
): Promise<PublicApiCacheResult<T>> {
  assertOptions(options);
  const key = sharedKey(options.key);
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<PublicApiCacheResult<T>>;

  beginActiveLoad(key);
  const promise = loadCached(options).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
    finishActiveLoad(key);
  });
  inFlight.set(key, promise as Promise<PublicApiCacheResult<unknown>>);
  return promise;
}

export async function invalidatePublicApiCache(logicalKey: string): Promise<void> {
  assertNamespace(logicalKey);
  const key = sharedKey(logicalKey);
  const lockKey = leaseKey(logicalKey);
  if ((activeLoads.get(key) ?? 0) > 0) bumpKeyInvalidationEpoch(key);
  inFlight.delete(key);
  await Promise.all([
    backend.deleteKeys([key, lockKey]),
    backend.reconcileGeneration({
      key: generationKey(logicalKey),
      candidate: Date.now(),
      advance: true,
    }),
  ]);
}

export async function getPublicApiCacheNamespaceGeneration(namespace: string): Promise<number> {
  assertNamespace(namespace);
  return backend.reconcileGeneration({
    key: generationKey(namespace),
    candidate: 0,
    advance: false,
  });
}

export async function invalidatePublicApiCacheNamespace(namespace: string): Promise<number> {
  assertNamespace(namespace);
  const prefix = sharedKey(`${namespace}:g`);
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
  return backend.reconcileGeneration({
    key: generationKey(namespace),
    candidate: Date.now(),
    advance: true,
  });
}

export async function getPublicApiCacheHealth(): Promise<PublicApiCacheHealth> {
  const now = Date.now();
  const window = healthWindow(now);
  return {
    store: "valkey",
    inFlightLoads: activeLoadTotal(),
    windowStartedAt: new Date(window.startedAt).toISOString(),
    windowSeconds: Math.max(1, Math.floor((now - window.startedAt) / 1_000)),
    recentRequests: window.requests,
    recentLeaseContentions: window.leaseContentions,
    recentValidationFailures: window.validationFailures,
    recentStaleServed: window.staleServed,
    leaseContentionRate: window.requests > 0 ? window.leaseContentions / window.requests : 0,
  };
}
