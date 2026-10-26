import { createHash } from "node:crypto";
import { fetchJsonFromKuboRpc } from "@/lib/ipfs/rpc-http";
import { extractIpfsPath } from "@/lib/ipfs/uri";
import { fetchPublicJson } from "@/lib/outbound-http";
import { getOrLoadValkeyJson } from "@/lib/valkey-cache";
const DEFAULT_MAX_BYTES = 1_048_576;
const MAX_CONFIGURED_BYTES = 16_777_216;
const DEFAULT_HTTPS_TIMEOUT_MS = 8_000;
const DEFAULT_IPFS_TIMEOUT_MS = 22_000;
function clampedPositiveInt(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}
export function registrationDocumentMaxBytes(): number {
  return clampedPositiveInt(
    process.env.REGISTRATION_JSON_MAX_BYTES ?? process.env.IPFS_RPC_MAX_RESPONSE_BYTES,
    DEFAULT_MAX_BYTES,
    1_024,
    MAX_CONFIGURED_BYTES,
  );
}
function decodedDataUriText(uri: string, maxBytes: number): string | null {
  const match = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(uri);
  if (!match) return null;
  const payload = match[2] ?? "";
  // Reject clearly oversized values before allocating a decoded buffer/string.
  if (payload.length > Math.ceil(maxBytes * 4 / 3) + 16) return null;
  try {
    if (match[1]) {
      if (!/^[A-Za-z0-9+/\s]*={0,2}$/.test(payload)) return null;
      const bytes = Buffer.from(payload.replace(/\s+/g, ""), "base64");
      if (bytes.byteLength > maxBytes) return null;
      return bytes.toString("utf8").replace(/^\uFEFF/, "");
    }
    const decoded = decodeURIComponent(payload).replace(/^\uFEFF/, "");
    return Buffer.byteLength(decoded, "utf8") <= maxBytes ? decoded : null;
  } catch {
    return null;
  }
}
export function parseRegistrationDataUri<T>(uri: string, maxBytes = registrationDocumentMaxBytes()): T | null {
  if (!uri.startsWith("data:")) return null;
  const text = decodedDataUriText(uri, maxBytes);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : null;
  } catch {
    return null;
  }
}
export type FetchRegistrationDocumentOptions = {
  httpsTimeoutMs?: number;
  ipfsTimeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
};
export type RegistrationDocumentFetchStatus =
  | "available"
  | "transient_unavailable"
  | "permanent_invalid"
  | "missing_uri";
export type RegistrationDocumentAttempt<T> = {
  status: RegistrationDocumentFetchStatus;
  data: T | null;
  errorClass: string | null;
  errorMessage: string | null;
  nextRetryAt: Date | null;
};
function permanentRegistrationDocumentError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const http = /http (\d{3})/.exec(message) ?? /failed \((\d{3})\)/.exec(message);
  if (http) {
    const status = Number(http[1]);
    if (status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429) return true;
  }
  return /invalid ipfs|not valid json|not valid utf-8|exceeded|exceeds|unsupported|unsafe|malformed/.test(message);
}
type CachedRegistrationDocumentAttempt = {
  status: RegistrationDocumentFetchStatus;
  data: Record<string, unknown> | null;
  errorClass: string | null;
  errorMessage: string | null;
  nextRetryAt: string | null;
};

const registrationAttemptInflight = new Map<
  string,
  Promise<CachedRegistrationDocumentAttempt>
>();
const registrationSignalIds = new WeakMap<AbortSignal, number>();
let nextRegistrationSignalId = 1;

function registrationInflightKey(cacheKey: string, signal?: AbortSignal): string {
  if (!signal) return `${cacheKey}\0signal:none`;
  let id = registrationSignalIds.get(signal);
  if (id == null) {
    id = nextRegistrationSignalId;
    nextRegistrationSignalId += 1;
    registrationSignalIds.set(signal, id);
  }
  return `${cacheKey}\0signal:${id}`;
}

function isCachedRegistrationDocumentAttempt(
  value: unknown,
): value is CachedRegistrationDocumentAttempt {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    row.status !== "available" &&
    row.status !== "transient_unavailable" &&
    row.status !== "permanent_invalid" &&
    row.status !== "missing_uri"
  ) {
    return false;
  }
  if (row.data !== null && (typeof row.data !== "object" || Array.isArray(row.data))) return false;
  if (row.errorClass !== null && typeof row.errorClass !== "string") return false;
  if (row.errorMessage !== null && typeof row.errorMessage !== "string") return false;
  if (row.nextRetryAt !== null) {
    if (typeof row.nextRetryAt !== "string" || !Number.isFinite(Date.parse(row.nextRetryAt))) {
      return false;
    }
  }
  if (row.status === "available") return row.data !== null;
  return row.data === null;
}

function toCachedRegistrationAttempt(
  attempt: RegistrationDocumentAttempt<unknown>,
): CachedRegistrationDocumentAttempt {
  return {
    status: attempt.status,
    data: attempt.data as Record<string, unknown> | null,
    errorClass: attempt.errorClass,
    errorMessage: attempt.errorMessage,
    nextRetryAt: attempt.nextRetryAt?.toISOString() ?? null,
  };
}

function fromCachedRegistrationAttempt<T>(
  attempt: CachedRegistrationDocumentAttempt,
): RegistrationDocumentAttempt<T> {
  return {
    status: attempt.status,
    data: attempt.data as T | null,
    errorClass: attempt.errorClass,
    errorMessage: attempt.errorMessage,
    nextRetryAt: attempt.nextRetryAt ? new Date(attempt.nextRetryAt) : null,
  };
}

function registrationCacheIdentity(uri: string): string {
  if (uri.startsWith("data:")) {
    return `data:sha256:${createHash("sha256").update(uri).digest("hex")}`;
  }
  const ipfsPath = extractIpfsPath(uri);
  if (ipfsPath) return `ipfs://${ipfsPath}`;
  if (uri.startsWith("https://")) {
    try {
      const url = new URL(uri);
      url.hash = "";
      return url.toString();
    } catch {
      // The loader will classify the malformed URL; retain a bounded hash key.
    }
  }
  return `raw:sha256:${createHash("sha256").update(uri).digest("hex")}`;
}

function registrationAttemptTtlSeconds(
  uri: string,
  attempt: CachedRegistrationDocumentAttempt,
): number {
  const immutable = uri.startsWith("data:") || extractIpfsPath(uri) != null;
  if (attempt.status === "available") return immutable ? 24 * 60 * 60 : 5 * 60;
  if (attempt.status === "permanent_invalid") return immutable ? 6 * 60 * 60 : 5 * 60;
  if (attempt.status === "transient_unavailable") {
    const retryAt = attempt.nextRetryAt ? Date.parse(attempt.nextRetryAt) : Date.now() + 30_000;
    return Math.max(5, Math.min(15 * 60, Math.ceil((retryAt - Date.now()) / 1_000)));
  }
  return 1;
}

async function awaitRegistrationAttempt<T>(
  promise: Promise<CachedRegistrationDocumentAttempt>,
  signal?: AbortSignal,
): Promise<RegistrationDocumentAttempt<T>> {
  if (!signal) return fromCachedRegistrationAttempt<T>(await promise);
  if (signal.aborted) throw signal.reason ?? new Error("Registration document fetch aborted");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Registration document fetch aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return fromCachedRegistrationAttempt<T>(await Promise.race([promise, aborted]));
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function loadRegistrationDocumentAttempt<T>(
  uri: string,
  maxBytes: number,
  options: FetchRegistrationDocumentOptions,
): Promise<RegistrationDocumentAttempt<T>> {
  if (uri.startsWith("data:")) {
    const data = parseRegistrationDataUri<T>(uri, maxBytes);
    return data == null || typeof data !== "object" || Array.isArray(data)
      ? { status: "permanent_invalid", data: null, errorClass: "registration_invalid", errorMessage: "Registration data URI must contain a JSON object", nextRetryAt: null }
      : { status: "available", data, errorClass: null, errorMessage: null, nextRetryAt: null };
  }
  try {
    let data: T;
    if (extractIpfsPath(uri)) {
      data = await fetchJsonFromKuboRpc<T>(uri, {
        apiUrl: process.env.IPFS_API_URL,
        bearerToken: process.env.IPFS_API_BEARER_TOKEN,
        signal: options.signal,
        timeoutMs: Math.min(
          120_000,
          Math.max(1_000, Math.trunc(options.ipfsTimeoutMs ?? clampedPositiveInt(
            process.env.IPFS_RPC_READ_TIMEOUT_MS,
            DEFAULT_IPFS_TIMEOUT_MS,
            1_000,
            120_000,
          ))),
        ),
        maxBytes,
      });
    } else if (uri.startsWith("https://")) {
      data = await fetchPublicJson<T>(uri, {
        signal: options.signal,
        timeoutMs: Math.min(
          45_000,
          Math.max(1_000, Math.trunc(options.httpsTimeoutMs ?? DEFAULT_HTTPS_TIMEOUT_MS)),
        ),
        maxResponseBytes: maxBytes,
        maxRedirects: 3,
      });
    } else {
      return { status: "permanent_invalid", data: null, errorClass: "registration_invalid", errorMessage: "Registration URI must use HTTPS, IPFS, or a JSON data URI", nextRetryAt: null };
    }
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
      return { status: "permanent_invalid", data: null, errorClass: "registration_invalid", errorMessage: "Registration document must be a JSON object", nextRetryAt: null };
    }
    return { status: "available", data, errorClass: null, errorMessage: null, nextRetryAt: null };
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    const permanent = permanentRegistrationDocumentError(error);
    const message = (error instanceof Error ? error.message : String(error)).replace(/\0/g, "").slice(0, 2_000);
    return permanent
      ? { status: "permanent_invalid", data: null, errorClass: "registration_invalid", errorMessage: message, nextRetryAt: null }
      : { status: "transient_unavailable", data: null, errorClass: "registration_unavailable", errorMessage: message, nextRetryAt: new Date(Date.now() + 15 * 60_000) };
  }
}
export async function fetchRegistrationDocumentAttempt<T>(
  rawUri: string,
  options: FetchRegistrationDocumentOptions = {},
): Promise<RegistrationDocumentAttempt<T>> {
  const uri = rawUri.trim();
  if (!uri) {
    return {
      status: "missing_uri",
      data: null,
      errorClass: null,
      errorMessage: null,
      nextRetryAt: null,
    };
  }
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Registration document fetch aborted");
  }
  const maxBytes = Math.min(
    MAX_CONFIGURED_BYTES,
    Math.max(1_024, Math.trunc(options.maxBytes ?? registrationDocumentMaxBytes())),
  );
  const identity = `${maxBytes}\0${registrationCacheIdentity(uri)}`;
  const digest = createHash("sha256").update(identity).digest("hex");
  const cacheKey = `registration-document:v2:${digest}`;
  const inflightKey = registrationInflightKey(cacheKey, options.signal);
  const existing = registrationAttemptInflight.get(inflightKey);
  if (existing) return awaitRegistrationAttempt<T>(existing, options.signal);

  const promise = getOrLoadValkeyJson<CachedRegistrationDocumentAttempt>({
    key: cacheKey,
    leaseKey: `registration-document-lock:v2:${digest}`,
    ttlSeconds: (attempt) => registrationAttemptTtlSeconds(uri, attempt),
    validate: isCachedRegistrationDocumentAttempt,
    maxPayloadBytes: maxBytes + 4_096,
    leaseTtlMs: Math.max(
      30_000,
      Math.min(180_000, Math.trunc(options.ipfsTimeoutMs ?? DEFAULT_IPFS_TIMEOUT_MS) + 10_000),
    ),
    waitMs: 30_000,
    signal: options.signal,
    load: async (signal) =>
      toCachedRegistrationAttempt(
        await loadRegistrationDocumentAttempt<unknown>(uri, maxBytes, {
          ...options,
          signal,
        }),
      ),
  });
  registrationAttemptInflight.set(inflightKey, promise);
  const clearInflight = () => {
    if (registrationAttemptInflight.get(inflightKey) === promise) {
      registrationAttemptInflight.delete(inflightKey);
    }
  };
  void promise.then(clearInflight, clearInflight);
  return awaitRegistrationAttempt<T>(promise, options.signal);
}

export async function fetchRegistrationDocument<T>(
  rawUri: string,
  options: FetchRegistrationDocumentOptions = {},
): Promise<T | null> {
  const attempt = await fetchRegistrationDocumentAttempt<T>(rawUri, options);
  return attempt.status === "available" ? attempt.data : null;
}
