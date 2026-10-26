import { stringifyJsonCompatible } from "./json-compatible";
const IGNORED_QUERY_KEYS = new Set(["_rsc", "nd"]);
const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
export type CacheEnvelope<T> = {
  version: 1;
  generatedAt: string;
  freshUntil: number;
  staleUntil: number;
  value: T;
};
export type PublicApiCacheStatus = "shared" | "origin" | "stale";
export type CachePolicy = {
  namespace: string;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  maxPayloadBytes: number;
  invalidation: "ttl" | "key" | "namespace-generation";
};
export type PublicApiCacheResult<T> = {
  value: T;
  generatedAt: string;
  status: PublicApiCacheStatus;
};
export type PublicApiCacheOptions<T> = {
  key: string;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  load: () => Promise<T>;
  validate: (value: unknown) => value is T;
  maxPayloadBytes?: number;
  leaseTtlMs?: number;
  leaseWaitMs?: number;
  /** Return false to serve a validated origin value without publishing it to Valkey. */
  shouldCacheValue?: (value: T) => boolean;
};
export type CacheEnvelopeValidationOptions<T> = {
  validate: (value: unknown) => value is T;
  maxPayloadBytes: number;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  now?: number;
  maxClockSkewMs?: number;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Validate both payload shape and the temporal bounds encoded by the active policy.
 * This prevents a malformed or manually injected Valkey envelope from extending its
 * own freshness/staleness beyond the configured cache lifetime.
 */
export function isPublicApiCacheEnvelope<T>(
  value: unknown,
  options: CacheEnvelopeValidationOptions<T>,
): value is CacheEnvelope<T> {
  if (!isRecord(value) || value.version !== 1) return false;
  if (typeof value.generatedAt !== "string") return false;
  const generatedAtMs = Date.parse(value.generatedAt);
  if (!Number.isFinite(generatedAtMs) || generatedAtMs < 0) return false;
  const freshUntil = value.freshUntil;
  const staleUntil = value.staleUntil;
  if (
    typeof freshUntil !== "number" ||
    typeof staleUntil !== "number" ||
    !Number.isSafeInteger(freshUntil) ||
    !Number.isSafeInteger(staleUntil)
  ) {
    return false;
  }
  const now = options.now ?? Date.now();
  const maxClockSkewMs = options.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
  if (!Number.isFinite(now) || !Number.isFinite(maxClockSkewMs) || maxClockSkewMs < 0) return false;
  if (generatedAtMs > now + maxClockSkewMs) return false;
  if (freshUntil < generatedAtMs || staleUntil < freshUntil) return false;
  if (freshUntil > generatedAtMs + options.freshTtlSeconds * 1_000 + maxClockSkewMs) return false;
  if (staleUntil > generatedAtMs + options.staleTtlSeconds * 1_000 + maxClockSkewMs) return false;
  if (!options.validate(value.value)) return false;
  try {
    return Buffer.byteLength(stringifyJsonCompatible(value.value), "utf8") <= options.maxPayloadBytes;
  } catch {
    return false;
  }
}
export function canonicalPublicApiQuery(searchParams: URLSearchParams): string {
  const entries: Array<[string, string]> = [];
  searchParams.forEach((value, key) => {
    if (!IGNORED_QUERY_KEYS.has(key)) entries.push([key, value]);
  });
  return entries
    .sort(([keyA, valueA], [keyB, valueB]) => keyA.localeCompare(keyB) || valueA.localeCompare(valueB))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}
export function publicApiCacheKey(namespace: string, searchParams?: URLSearchParams): string {
  const query = searchParams ? canonicalPublicApiQuery(searchParams) : "";
  return query ? `${namespace}?${query}` : namespace;
}
const STATUS_PRIORITY: Record<PublicApiCacheStatus, number> = {
  shared: 0,
  origin: 1,
  stale: 2,
};
export function combinePublicApiCacheResults<T>(
  value: T,
  constituents: readonly PublicApiCacheResult<unknown>[],
): PublicApiCacheResult<T> {
  if (constituents.length === 0) throw new TypeError("At least one cache constituent is required");
  const generatedAt = constituents.reduce((oldest, current) => {
    return Date.parse(current.generatedAt) < Date.parse(oldest) ? current.generatedAt : oldest;
  }, constituents[0]!.generatedAt);
  const status = constituents.reduce((leastFavorable, current) => {
    return STATUS_PRIORITY[current.status] > STATUS_PRIORITY[leastFavorable]
      ? current.status
      : leastFavorable;
  }, constituents[0]!.status);
  return { value, generatedAt, status };
}
