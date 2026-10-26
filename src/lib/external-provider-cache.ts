import "server-only";
import { stringifyJsonCompatible } from "@/lib/json-compatible";
import {
  ValkeyLeaseBusyError,
  valkeyGetValidatedJson,
  valkeySetJson,
  valkeySetJsonIfLeaseOwner,
  withValkeyLease,
} from "@/lib/valkey";

const CACHE_PREFIX = "external-provider:v1:";
const LEASE_PREFIX = "external-provider-lock:v1:";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_LEASE_WAIT_MS = 5_000;

export type ExternalProviderCacheEnvelope<T> = {
  version: 1;
  fetchedAt: string;
  freshUntil: number;
  staleUntil: number;
  value: T;
};

export type ExternalProviderCacheRead<T> = {
  value: T;
  fetchedAt: string;
  status: "fresh" | "stale";
  source: "valkey" | "provider";
};

function normalizedIdentity(key: string): string {
  const normalized = key.trim();
  if (!normalized || normalized.length > 512) {
    throw new Error("External provider cache key must contain 1-512 characters");
  }
  return normalized;
}

function namespacedKey(key: string): string {
  return `${CACHE_PREFIX}${normalizedIdentity(key)}`;
}

function leaseKey(key: string): string {
  return `${LEASE_PREFIX}${normalizedIdentity(key)}`;
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(stringifyJsonCompatible(value), "utf8");
}

function normalizeCachePolicy(input: {
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  maxPayloadBytes: number;
}): { freshTtlSeconds: number; staleTtlSeconds: number; maxPayloadBytes: number } {
  if (!Number.isFinite(input.freshTtlSeconds) || input.freshTtlSeconds <= 0) {
    throw new RangeError("External provider fresh TTL must be a positive finite number");
  }
  if (!Number.isFinite(input.staleTtlSeconds) || input.staleTtlSeconds <= 0) {
    throw new RangeError("External provider stale TTL must be a positive finite number");
  }
  if (!Number.isSafeInteger(input.maxPayloadBytes) || input.maxPayloadBytes <= 0) {
    throw new RangeError("External provider max payload bytes must be a positive safe integer");
  }
  const freshTtlSeconds = Math.max(1, Math.trunc(input.freshTtlSeconds));
  return {
    freshTtlSeconds,
    staleTtlSeconds: Math.max(freshTtlSeconds, Math.trunc(input.staleTtlSeconds)),
    maxPayloadBytes: input.maxPayloadBytes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnvelope<T>(
  value: unknown,
  input: {
    validate: (candidate: unknown) => candidate is T;
    maxPayloadBytes: number;
    freshTtlSeconds: number;
    staleTtlSeconds: number;
    now: number;
  },
): value is ExternalProviderCacheEnvelope<T> {
  if (!isRecord(value) || value.version !== 1) return false;
  if (typeof value.fetchedAt !== "string") return false;
  const fetchedAtMs = Date.parse(value.fetchedAt);
  if (!Number.isFinite(fetchedAtMs) || fetchedAtMs > input.now + MAX_CLOCK_SKEW_MS) return false;
  const freshUntil = value.freshUntil;
  const staleUntil = value.staleUntil;
  if (typeof freshUntil !== "number" || !Number.isSafeInteger(freshUntil)) return false;
  if (typeof staleUntil !== "number" || !Number.isSafeInteger(staleUntil)) return false;
  const policy = normalizeCachePolicy(input);
  const freshTtlMs = policy.freshTtlSeconds * 1_000;
  const staleTtlMs = policy.staleTtlSeconds * 1_000;
  if (freshUntil < fetchedAtMs || staleUntil < freshUntil) return false;
  if (freshUntil > fetchedAtMs + freshTtlMs + MAX_CLOCK_SKEW_MS) return false;
  if (staleUntil > fetchedAtMs + staleTtlMs + MAX_CLOCK_SKEW_MS) return false;
  if (input.now > staleUntil) return false;
  if (!input.validate(value.value)) return false;
  try {
    return serializedBytes(value) <= input.maxPayloadBytes;
  } catch {
    return false;
  }
}

function createEnvelope<T>(input: {
  value: T;
  validate: (candidate: unknown) => candidate is T;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  maxPayloadBytes: number;
}): ExternalProviderCacheEnvelope<T> {
  if (!input.validate(input.value)) throw new Error("External provider payload failed validation");
  const now = Date.now();
  const policy = normalizeCachePolicy(input);
  const envelope: ExternalProviderCacheEnvelope<T> = {
    version: 1,
    fetchedAt: new Date(now).toISOString(),
    freshUntil: now + policy.freshTtlSeconds * 1_000,
    staleUntil: now + policy.staleTtlSeconds * 1_000,
    value: input.value,
  };
  const bytes = serializedBytes(envelope);
  if (bytes > policy.maxPayloadBytes) {
    throw new Error(
      `External provider payload is ${bytes} bytes; maximum is ${policy.maxPayloadBytes}`,
    );
  }
  return envelope;
}

/** Read a versioned external-provider snapshot from the authoritative Valkey cache. */
export async function readExternalProviderCache<T>(input: {
  key: string;
  validate: (candidate: unknown) => candidate is T;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  maxPayloadBytes: number;
}): Promise<ExternalProviderCacheRead<T> | null> {
  const policy = normalizeCachePolicy(input);
  const now = Date.now();
  const envelope = await valkeyGetValidatedJson(
    namespacedKey(input.key),
    (candidate): candidate is ExternalProviderCacheEnvelope<T> =>
      isEnvelope(candidate, { ...input, ...policy, now }),
  );
  if (envelope === null) return null;
  return {
    value: envelope.value,
    fetchedAt: envelope.fetchedAt,
    status: now <= envelope.freshUntil ? "fresh" : "stale",
    source: "valkey",
  };
}

export async function writeExternalProviderCache<T>(input: {
  key: string;
  value: T;
  validate: (candidate: unknown) => candidate is T;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  maxPayloadBytes: number;
}): Promise<void> {
  const policy = normalizeCachePolicy(input);
  const envelope = createEnvelope({ ...input, ...policy });
  await valkeySetJson(namespacedKey(input.key), envelope, policy.staleTtlSeconds);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("External-provider cache wait aborted"));
      return;
    }
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("External-provider cache wait aborted"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForExternalProviderPublication<T>(input: {
  key: string;
  validate: (candidate: unknown) => candidate is T;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  maxPayloadBytes: number;
  waitMs: number;
  signal?: AbortSignal;
}): Promise<ExternalProviderCacheRead<T> | null> {
  const deadline = Date.now() + input.waitMs;
  while (Date.now() < deadline) {
    await sleep(100 + Math.floor(Math.random() * 151), input.signal);
    const cached = await readExternalProviderCache(input);
    if (cached?.status === "fresh") return cached;
  }
  return null;
}

/**
 * Read-through external-provider cache with a distributed refresh lease.
 * Only errors thrown by `load` may fall back to a still-valid stale snapshot; Valkey
 * coordination and publication errors always propagate.
 */
export async function getExternalProviderCached<T>(input: {
  key: string;
  validate: (candidate: unknown) => candidate is T;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  maxPayloadBytes: number;
  load: (signal: AbortSignal) => Promise<T>;
  /**
   * Controls whether a provider load failure may be masked by a still-valid stale snapshot.
   * Defaults to true. Callers should return false for failures that change credential validity.
   */
  shouldUseStaleOnLoadError?: (error: unknown) => boolean;
  signal?: AbortSignal;
  leaseTtlMs?: number;
  leaseWaitMs?: number;
}): Promise<ExternalProviderCacheRead<T>> {
  const policy = normalizeCachePolicy(input);
  const initial = await readExternalProviderCache({ ...input, ...policy });
  if (initial?.status === "fresh") return initial;
  const refreshLeaseKey = leaseKey(input.key);
  const leaseTtlMs = Math.min(
    5 * 60_000,
    Math.max(2_000, Math.trunc(input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS)),
  );
  const leaseWaitMs = Math.min(
    65_000,
    Math.max(250, Math.trunc(input.leaseWaitMs ?? DEFAULT_LEASE_WAIT_MS)),
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withValkeyLease(
        { key: refreshLeaseKey, ttlMs: leaseTtlMs },
        async (leaseSignal, lease) => {
          const signal = input.signal
            ? AbortSignal.any([leaseSignal, input.signal])
            : leaseSignal;
          const concurrent = await readExternalProviderCache({ ...input, ...policy });
          if (concurrent?.status === "fresh") return concurrent;
          const stale = concurrent ?? initial;
          let loaded: T;
          try {
            loaded = await input.load(signal);
          } catch (providerError) {
            if (
              stale
              && (input.shouldUseStaleOnLoadError?.(providerError) ?? true)
            ) {
              return stale;
            }
            throw providerError;
          }
          const envelope = createEnvelope({ ...input, ...policy, value: loaded });
          const published = await valkeySetJsonIfLeaseOwner({
            key: namespacedKey(input.key),
            leaseKey: refreshLeaseKey,
            token: lease.token,
            value: envelope,
            ttlSeconds: policy.staleTtlSeconds,
          });
          if (!published) {
            throw new Error(`External-provider refresh lease was lost for ${input.key}`);
          }
          return {
            value: envelope.value,
            fetchedAt: envelope.fetchedAt,
            status: "fresh",
            source: "provider",
          };
        },
      );
    } catch (error) {
      if (!(error instanceof ValkeyLeaseBusyError)) throw error;
      if (initial) return initial;
      const published = await waitForExternalProviderPublication({
        ...input,
        ...policy,
        waitMs: leaseWaitMs,
      });
      if (published) return published;
      if (attempt === 1) throw error;
    }
  }
  throw new Error(`Unable to coordinate external-provider refresh for ${input.key}`);
}
