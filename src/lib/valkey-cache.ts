import "server-only";
import { stringifyJsonCompatible } from "@/lib/json-compatible";
import {
  ValkeyLeaseBusyError,
  valkeyGetValidatedJson,
  valkeySetJsonIfLeaseOwner,
  withValkeyLease,
} from "@/lib/valkey";

const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_WAIT_MS = 15_000;

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value)) throw new RangeError("Cache timing values must be finite");
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function assertKey(key: string, label: string): string {
  const normalized = key.trim();
  if (!normalized || normalized.length > 512) {
    throw new RangeError(`${label} must contain 1-512 characters`);
  }
  return normalized;
}

function combinedSignal(first: AbortSignal, second?: AbortSignal): AbortSignal {
  if (!second) return first;
  return AbortSignal.any([first, second]);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Cache wait aborted"));
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Cache wait aborted"));
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForValue<T>(input: {
  key: string;
  validate: (candidate: unknown) => candidate is T;
  waitMs: number;
  signal?: AbortSignal;
}): Promise<T | null> {
  const deadline = Date.now() + input.waitMs;
  while (Date.now() < deadline) {
    await sleep(100 + Math.floor(Math.random() * 151), input.signal);
    const cached = await valkeyGetValidatedJson(input.key, input.validate);
    if (cached !== null) return cached;
  }
  return null;
}

/**
 * Authoritative Valkey JSON cache with process-local-free distributed refresh coordination.
 * The loader publishes only while it still owns the lease, preventing an expired loader from
 * overwriting a newer value produced by another process.
 */
export async function getOrLoadValkeyJson<T>(input: {
  key: string;
  leaseKey?: string;
  ttlSeconds: number | ((value: T) => number);
  validate: (candidate: unknown) => candidate is T;
  load: (signal: AbortSignal) => Promise<T>;
  maxPayloadBytes?: number;
  leaseTtlMs?: number;
  waitMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const key = assertKey(input.key, "Valkey cache key");
  const leaseKey = assertKey(input.leaseKey ?? `${key}:lease`, "Valkey cache lease key");
  const ttlResolver = typeof input.ttlSeconds === "function" ? input.ttlSeconds : null;
  const staticTtlSeconds =
    typeof input.ttlSeconds === "number"
      ? boundedInteger(input.ttlSeconds, 60, 1, 30 * 24 * 60 * 60)
      : null;
  const maxPayloadBytes = boundedInteger(
    input.maxPayloadBytes,
    DEFAULT_MAX_PAYLOAD_BYTES,
    1,
    64 * 1024 * 1024,
  );
  const leaseTtlMs = boundedInteger(input.leaseTtlMs, DEFAULT_LEASE_TTL_MS, 2_000, 60 * 60_000);
  const waitMs = boundedInteger(input.waitMs, DEFAULT_WAIT_MS, 250, 65_000);
  if (input.signal?.aborted) throw input.signal.reason ?? new Error("Cache load aborted");

  const initial = await valkeyGetValidatedJson(key, input.validate);
  if (initial !== null) return initial;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withValkeyLease(
        { key: leaseKey, ttlMs: leaseTtlMs },
        async (leaseSignal, lease) => {
          const signal = combinedSignal(leaseSignal, input.signal);
          const publishedWhileWaiting = await valkeyGetValidatedJson(key, input.validate);
          if (publishedWhileWaiting !== null) return publishedWhileWaiting;
          const loaded = await input.load(signal);
          if (!input.validate(loaded)) {
            throw new TypeError(`Valkey cache loader returned an invalid payload for ${key}`);
          }
          const serialized = stringifyJsonCompatible(loaded);
          const payloadBytes = Buffer.byteLength(serialized, "utf8");
          if (payloadBytes > maxPayloadBytes) {
            throw new RangeError(
              `Valkey cache payload for ${key} is ${payloadBytes} bytes; maximum is ${maxPayloadBytes}`,
            );
          }
          const canonical = JSON.parse(serialized) as unknown;
          if (!input.validate(canonical)) {
            throw new TypeError(`Serialized Valkey cache payload failed validation for ${key}`);
          }
          const resolvedTtlSeconds =
            staticTtlSeconds ??
            boundedInteger(ttlResolver!(canonical as T), 60, 1, 30 * 24 * 60 * 60);
          const published = await valkeySetJsonIfLeaseOwner({
            key,
            leaseKey,
            token: lease.token,
            value: canonical,
            ttlSeconds: resolvedTtlSeconds,
          });
          if (!published) throw new Error(`Valkey cache lease was lost before publishing ${key}`);
          return canonical as T;
        },
      );
    } catch (error) {
      if (!(error instanceof ValkeyLeaseBusyError)) throw error;
      const published = await waitForValue({
        key,
        validate: input.validate,
        waitMs,
        signal: input.signal,
      });
      if (published !== null) return published;
      if (attempt === 1) throw error;
    }
  }
  throw new Error(`Unable to coordinate Valkey cache load for ${key}`);
}
