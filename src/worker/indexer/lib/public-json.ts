import { parseOptionalContentLength } from "./strict-integer.js";
import { throwIfAborted } from "./abort.js";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Pool } from "undici";
import { config } from "../config.js";
import { isIP } from "node:net";
import { createResourceProfile } from "../resources/resource-profile.js";
import { getOrCreateResourceScheduler, type ResourceScheduler } from "../resources/resource-scheduler.js";
import { httpOriginResourceKey } from "../resources/resource-key.js";
import { valkeyGetValidatedJson, valkeySetJson } from "@/lib/valkey";
function publicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}
function ipv6Groups(address: string): number[] | null {
  let normalized = address.toLowerCase().split("%", 1)[0] ?? "";
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1).split(".").map(Number);
    if (lastColon < 0 || ipv4.length !== 4 || ipv4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }
  if ((normalized.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw !== undefined && rightRaw ? rightRaw.split(":").filter(Boolean) : [];
  if (rightRaw === undefined && left.length !== 8) return null;
  const missing = rightRaw === undefined ? 0 : 8 - left.length - right.length;
  if (missing < 1 && rightRaw !== undefined) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) => /^[0-9a-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : Number.NaN);
  return groups.length === 8 && groups.every(Number.isInteger) ? groups : null;
}
function publicAddress(value: string): boolean {
  const family = isIP(value);
  if (family === 4) return publicIpv4(value);
  if (family !== 6) return false;
  const groups = ipv6Groups(value);
  if (!groups) return false;
  const mapped = groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff;
  const compatible = groups.slice(0, 6).every((part) => part === 0);
  if (mapped || compatible) {
    const high = groups[6]!;
    const low = groups[7]!;
    const embedded = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    if (compatible && (embedded === "0.0.0.0" || embedded === "0.0.0.1")) return false;
    return publicIpv4(embedded);
  }
  if ((groups[0]! & 0xfe00) === 0xfc00) return false;
  if ((groups[0]! & 0xffc0) === 0xfe80 || (groups[0]! & 0xffc0) === 0xfec0) return false;
  if ((groups[0]! & 0xff00) === 0xff00) return false;
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return false;
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return false;
  if (groups[0] === 0x2001 && (groups[1] === 0 || groups[1] === 2 || groups[1] === 0x0db8)) return false;
  if (groups[0] === 0x2001 && ((groups[1]! & 0xfff0) === 0x0010 || (groups[1]! & 0xfff0) === 0x0020)) return false;
  if (groups[0] === 0x2002 || groups[0] === 0x3ffe) return false;
  return true;
}
function validateUrl(raw: string): URL {
  if (raw.length > 2_048) throw new Error("Metadata URL is too long");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Metadata URL must use HTTPS");
  if (url.username || url.password) throw new Error("Metadata URL credentials are not allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Local metadata hosts are not allowed");
  }
  if (isIP(hostname) && !publicAddress(hostname)) throw new Error("Private metadata addresses are not allowed");
  url.hash = "";
  return url;
}
type ResolvedAddress = { address: string; family: 4 | 6; expiresAt: number };
const MAX_DNS_CACHE_ENTRIES = 4_096;
const MAX_IDLE_POOLS = 128;
// Registration URLs are untrusted and can contain effectively unlimited
// origins. Fixed shards preserve distributed backpressure without allocating a
// scheduler and durable resource-state row for every distinct hostname.
const ORIGIN_SCHEDULER_BUCKETS = 256;
const dnsCache = new Map<string, ResolvedAddress>();
const pools = new Map<string, Pool>();
const originSchedulers = new Map<string, ResourceScheduler>();
type ConditionalEntry = {
  etag: string | null;
  lastModified: string | null;
  bytes: Uint8Array;
  contentType: string | null;
  finalUrl: string;
};
type SerializedConditionalEntry = Omit<ConditionalEntry, "bytes"> & { bytesBase64: string };
const conditionalEntryLoads = new Map<string, Promise<ConditionalEntry | null>>();
const CONDITIONAL_CACHE_TTL_SECONDS = 10 * 60;
// Avoid turning unusually large metadata responses into multi-megabyte shared values.
const MAX_SHARED_CONDITIONAL_BYTES = 2 * 1024 * 1024;
function conditionalCacheKey(url: string): string {
  return `indexer:public-bytes:v2:${createHash("sha256").update(url).digest("hex")}`;
}
function nullableBoundedString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}
function canonicalBase64ByteLength(value: string): number | null {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const dataLength = value.length - padding;
  if (padding > 0 && dataLength === 0) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const tail = dataLength > 0 ? alphabet.indexOf(value[dataLength - 1]!) : 0;
  // Reject non-zero unused padding bits, matching Buffer's canonical encoder
  // without decoding and re-encoding the entire cached body.
  if ((padding === 2 && (tail & 0x0f) !== 0) || (padding === 1 && (tail & 0x03) !== 0)) return null;
  return value.length / 4 * 3 - padding;
}
function isSerializedConditionalEntry(value: unknown): value is SerializedConditionalEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SerializedConditionalEntry>;
  if (!nullableBoundedString(candidate.etag, 4_096)) return false;
  if (!nullableBoundedString(candidate.lastModified, 1_024)) return false;
  if (!nullableBoundedString(candidate.contentType, 1_024)) return false;
  if (typeof candidate.finalUrl !== "string" || candidate.finalUrl.length > 2_048) return false;
  if (typeof candidate.bytesBase64 !== "string" || candidate.bytesBase64.length > Math.ceil(MAX_SHARED_CONDITIONAL_BYTES / 3) * 4 + 4) return false;
  const decodedLength = canonicalBase64ByteLength(candidate.bytesBase64);
  return decodedLength != null && decodedLength <= MAX_SHARED_CONDITIONAL_BYTES;
}
async function readConditionalEntry(url: string): Promise<ConditionalEntry | null> {
  const key = conditionalCacheKey(url);
  const existing = conditionalEntryLoads.get(key);
  if (existing) return existing;
  const pending = valkeyGetValidatedJson(key, isSerializedConditionalEntry)
    .then((serialized): ConditionalEntry | null => serialized == null ? null : ({
      etag: serialized.etag,
      lastModified: serialized.lastModified,
      bytes: Buffer.from(serialized.bytesBase64, "base64"),
      contentType: serialized.contentType,
      finalUrl: serialized.finalUrl,
    }))
    .finally(() => {
      if (conditionalEntryLoads.get(key) === pending) conditionalEntryLoads.delete(key);
    });
  conditionalEntryLoads.set(key, pending);
  return pending;
}
async function writeConditionalEntry(url: string, entry: ConditionalEntry): Promise<void> {
  // Without a validator the bytes can never satisfy a later 304 response, so
  // retaining them only turns high-cardinality metadata URLs into Valkey churn.
  if (!entry.etag && !entry.lastModified) return;
  if (entry.bytes.byteLength > MAX_SHARED_CONDITIONAL_BYTES) return;
  const serialized: SerializedConditionalEntry = {
    etag: entry.etag,
    lastModified: entry.lastModified,
    bytesBase64: Buffer.isBuffer(entry.bytes)
      ? entry.bytes.toString("base64")
      : Buffer.from(entry.bytes).toString("base64"),
    contentType: entry.contentType,
    finalUrl: entry.finalUrl,
  };
  await valkeySetJson(conditionalCacheKey(url), serialized, CONDITIONAL_CACHE_TTL_SECONDS);
}
async function resolveAddress(hostname: string, signal?: AbortSignal): Promise<{ address: string; family: 4 | 6 }> {
  throwIfAborted(signal);
  if (isIP(hostname)) return { address: hostname, family: isIP(hostname) as 4 | 6 };
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    dnsCache.delete(hostname);
    dnsCache.set(hostname, cached);
    return { address: cached.address, family: cached.family };
  }
  if (cached) dnsCache.delete(hostname);
  const rows = await lookup(hostname, { all: true, verbatim: true });
  throwIfAborted(signal);
  if (!rows.length) throw new Error("Metadata host did not resolve");
  const blocked = rows.find((row) => !publicAddress(row.address));
  if (blocked) throw new Error(`Metadata host resolved to blocked address ${blocked.address}`);
  rows.sort((a, b) => a.family - b.family || a.address.localeCompare(b.address));
  const selected = rows[0];
  if (!selected) throw new Error("Metadata host did not resolve");
  const resolved = { address: selected.address, family: selected.family as 4 | 6 };
  dnsCache.set(hostname, { ...resolved, expiresAt: Date.now() + config.metadataDnsCacheTtlMs });
  while (dnsCache.size > MAX_DNS_CACHE_ENTRIES) {
    const oldest = dnsCache.keys().next().value as string | undefined;
    if (oldest == null) break;
    dnsCache.delete(oldest);
  }
  return resolved;
}
function evictIdlePools(retainedKey: string): void {
  if (pools.size <= MAX_IDLE_POOLS) return;
  for (const [key, candidate] of pools) {
    if (pools.size <= MAX_IDLE_POOLS) return;
    if (key === retainedKey || candidate.stats.size !== 0) continue;
    pools.delete(key);
    void candidate.close().catch(() => undefined);
  }
}
function poolFor(url: URL, target: { address: string; family: 4 | 6 }): Pool {
  const key = `${url.origin}|${target.family}|${target.address}`;
  const existing = pools.get(key);
  if (existing) {
    pools.delete(key);
    pools.set(key, existing);
    evictIdlePools(key);
    return existing;
  }
  const pool = new Pool(url.origin, {
    connections: config.metadataOriginDefaultMaxInflight,
    pipelining: 1,
    connect: {
      servername: isIP(url.hostname) ? undefined : url.hostname,
      lookup(_hostname, options, callback) {
        const all = typeof options === "object" && options != null && "all" in options && options.all === true;
        if (all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      },
    },
  });
  pools.set(key, pool);
  evictIdlePools(key);
  return pool;
}
function schedulerForOrigin(origin: string): ResourceScheduler {
  const digest = createHash("sha256").update(new URL(origin).origin.toLowerCase()).digest("hex");
  const bucket = Number.parseInt(digest.slice(0, 8), 16) % ORIGIN_SCHEDULER_BUCKETS;
  const bucketKey = `metadata-origin:${bucket}`;
  const existing = originSchedulers.get(bucketKey);
  if (existing) return existing;
  const scheduler = getOrCreateResourceScheduler(
    httpOriginResourceKey(`https://metadata-origin-bucket-${bucket}.invalid`),
    createResourceProfile({
      minCapacity: 1,
      maxCapacity: config.metadataOriginDefaultMaxInflight,
      successWindow: config.rpcAimdSuccessWindow,
      decreaseFactor: config.rpcAimdDecreaseFactor,
      leaseTtlMs: config.resourceLeaseTtlMs,
      leaseHeartbeatMs: config.resourceLeaseHeartbeatMs,
      leaseAcquirePollMs: config.resourceLeaseAcquirePollMs,
    }),
  );
  originSchedulers.set(bucketKey, scheduler);
  return scheduler;
}
function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
async function readBoundedBody(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(`Metadata response exceeded ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
type DiscardableResponseBody = {
  dump(options?: { limit?: number }): Promise<void>;
};
const RESPONSE_BODY_DUMP_LIMIT_BYTES = 128 * 1024;
async function discardResponseBody(body: DiscardableResponseBody, signal: AbortSignal): Promise<void> {
  try {
    await body.dump({ limit: RESPONSE_BODY_DUMP_LIMIT_BYTES });
  } catch {
    // dump() owns the response stream lifecycle even when its bounded limit is
    // exceeded or the peer closes early. Only a caller-requested abort changes
    // control flow; provider cleanup failures must not escape as stream events.
    if (signal.aborted) throwIfAborted(signal);
  }
}
function acceptableMetadataContentType(value: string | undefined): boolean {
  if (!value) return true;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true || mediaType === "text/plain" || mediaType === "application/octet-stream";
}
async function oneRequest(
  url: URL,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ status: number; body?: Uint8Array; location?: string; contentType?: string; etag?: string; lastModified?: string }> {
  throwIfAborted(signal);
  const target = await resolveAddress(url.hostname, signal);
  const cached = await readConditionalEntry(url.toString());
  const headers: Record<string, string> = {
    Host: url.host,
    Accept: "application/json, application/*+json;q=0.9, text/plain;q=0.5",
    "Accept-Encoding": "identity",
    "User-Agent": "AgentRanking-Indexer/1.0",
  };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;
  const response = await schedulerForOrigin(url.origin).run(
    (resourceSignal) => poolFor(url, target).request({
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers,
      signal: resourceSignal ?? signal,
    }),
    {
      signal,
      classifyResult(value) {
        if (value.statusCode === 429) return { kind: "rate_limit" };
        if (value.statusCode === 502 || value.statusCode === 503 || value.statusCode === 504) {
          return { kind: "transient" };
        }
        return null;
      },
    },
  );
  const responseHeaders = response.headers as Record<string, string | string[] | undefined>;
  const status = response.statusCode;
  const location = headerValue(responseHeaders, "location");
  const contentType = headerValue(responseHeaders, "content-type");
  if ([301, 302, 303, 307, 308].includes(status)) {
    await discardResponseBody(response.body, signal);
    return { status, location, contentType };
  }
  if (status === 304 && cached) {
    await discardResponseBody(response.body, signal);
    return { status: 200, body: cached.bytes, contentType: cached.contentType ?? undefined, etag: cached.etag ?? undefined, lastModified: cached.lastModified ?? undefined };
  }
  if (status < 200 || status >= 300) {
    await discardResponseBody(response.body, signal);
    return { status, contentType };
  }
  if (!acceptableMetadataContentType(contentType)) {
    await discardResponseBody(response.body, signal);
    throw new Error(`Metadata response has unsupported content type ${contentType?.split(";", 1)[0] ?? "unknown"}`);
  }
  const declaredLength = parseOptionalContentLength(headerValue(responseHeaders, "content-length"), "metadata Content-Length");
  if (declaredLength != null && declaredLength > maxBytes) {
    await discardResponseBody(response.body, signal);
    throw new Error(`Metadata response exceeded ${maxBytes} bytes`);
  }
  const body = await readBoundedBody(response.body, maxBytes);
  return { status, body, contentType, etag: headerValue(responseHeaders, "etag"), lastModified: headerValue(responseHeaders, "last-modified") };
}
export type PublicByteResponse = {
  bytes: Uint8Array;
  finalUrl: string;
  contentType: string | null;
};
export async function fetchPublicBytes(raw: string, timeoutMs: number, maxBytes: number, signal?: AbortSignal): Promise<PublicByteResponse> {
  const boundedTimeout = Number.isFinite(timeoutMs)
    ? Math.min(120_000, Math.max(1, Math.trunc(timeoutMs)))
    : 15_000;
  const boundedBytes = Number.isFinite(maxBytes)
    ? Math.min(16_777_216, Math.max(1_024, Math.trunc(maxBytes)))
    : 1_048_576;
  throwIfAborted(signal);
  const deadline = AbortSignal.timeout(boundedTimeout);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let current = validateUrl(raw);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    throwIfAborted(requestSignal);
    const response = await oneRequest(current, boundedBytes, requestSignal);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      if (redirects === 3) throw new Error("Metadata request exceeded redirect limit");
      current = validateUrl(new URL(response.location, current).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Metadata URL returned HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("Metadata response body is unavailable");
    const result = { bytes: response.body, finalUrl: current.toString(), contentType: response.contentType ?? null };
    if (response.etag || response.lastModified) {
      await writeConditionalEntry(current.toString(), {
        etag: response.etag ?? null,
        lastModified: response.lastModified ?? null,
        bytes: response.body,
        contentType: result.contentType,
        finalUrl: result.finalUrl,
      });
    }
    return result;
  }
  throw new Error("Metadata request exceeded redirect limit");
}
export async function drainPublicMetadataClients(): Promise<void> {
  await Promise.all([...originSchedulers.values()].map((scheduler) => scheduler.onIdle()));
  await Promise.all([...pools.values()].map((pool) => pool.close()));
  pools.clear();
  originSchedulers.clear();
  dnsCache.clear();
}
/** Compatibility wrapper. New registration code consumes bytes through the common lossless decoder. */
export async function fetchPublicJson<T>(raw: string, timeoutMs: number, maxBytes: number, signal?: AbortSignal): Promise<T> {
  const response = await fetchPublicBytes(raw, timeoutMs, maxBytes, signal);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
  } catch (error) {
    throw new Error("Metadata response is not valid UTF-8", { cause: error });
  }
  return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
}
