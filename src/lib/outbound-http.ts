import { lookup } from "node:dns/promises";
import http, {
  type ClientRequest,
  type IncomingHttpHeaders,
  validateHeaderName,
  validateHeaderValue,
} from "node:http";
import https, { type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { domainToASCII, domainToUnicode } from "node:url";
const DEFAULT_MAX_URL_LENGTH = 2_048;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MANAGED_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "proxy-connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "accept-encoding",
]);
const CROSS_ORIGIN_REDIRECT_SAFE_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
  "user-agent",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "range",
  "x-request-id",
  "traceparent",
  "tracestate",
  "baggage",
]);
function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(candidate)));
}
type AddressFamily = 4 | 6;
export type ResolvedAddress = {
  address: string;
  family: AddressFamily;
};
export type PublicHttpUrlOptions = {
  allowHttp?: boolean;
  allowLocalhost?: boolean;
  maxUrlLength?: number;
};
export type OutboundHttpRequestOptions = PublicHttpUrlOptions & {
  method?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
};
export type OutboundHttpResponse = {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  bodyBytes: Buffer;
  truncated: boolean;
};
/** A deterministic destination-policy failure. Retrying the same URL cannot succeed. */
export class OutboundTargetRejectedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OutboundTargetRejectedError";
  }
}
export function isPermanentOutboundTargetError(
  error: unknown,
): error is OutboundTargetRejectedError {
  return error instanceof OutboundTargetRejectedError;
}
function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    return Number.parseInt(part, 10);
  });
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? numbers
    : null;
}
function isPublicIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}
function normalizeIpv6(address: string): string {
  return address.toLowerCase().split("%", 1)[0] ?? "";
}
function parseIpv6Groups(address: string): number[] | null {
  let normalized = normalizeIpv6(address);
  if (!normalized) return null;
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (!ipv4) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }
  if ((normalized.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw !== undefined && rightRaw ? rightRaw.split(":").filter(Boolean) : [];
  if (rightRaw === undefined && left.length !== 8) return null;
  const missing = rightRaw === undefined ? 0 : 8 - left.length - right.length;
  if (missing < 1 && rightRaw !== undefined) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return Number.NaN;
    return Number.parseInt(part, 16);
  });
  return groups.length === 8 && groups.every(Number.isInteger) ? groups : null;
}
function mappedIpv4(address: string): string | null {
  const groups = parseIpv6Groups(address);
  if (!groups) return null;
  const mapped = groups.slice(0, 5).every((value) => value === 0) && groups[5] === 0xffff;
  const compatible = groups.slice(0, 6).every((value) => value === 0);
  if (!mapped && !compatible) return null;
  const high = groups[6]!;
  const low = groups[7]!;
  const value = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  // Preserve the IPv6 unspecified and loopback special cases for the caller.
  return compatible && (value === "0.0.0.0" || value === "0.0.0.1") ? null : value;
}
function isPublicIpv6(address: string): boolean {
  const normalized = normalizeIpv6(address);
  const groups = parseIpv6Groups(normalized);
  if (!groups) return false;
  const mapped = mappedIpv4(normalized);
  if (mapped) return isPublicIpv4(mapped);
  if (groups.every((value) => value === 0)) return false;
  if (groups.slice(0, 7).every((value) => value === 0) && groups[7] === 1) return false;
  // Public IPv6 unicast is allocated from 2000::/3. Treat every other
  // non-mapped range as non-public rather than assuming unallocated space is
  // safe; private networks can route arbitrary locally chosen prefixes.
  if ((groups[0]! & 0xe000) !== 0x2000) return false;
  if ((groups[0]! & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
  if ((groups[0]! & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((groups[0]! & 0xffc0) === 0xfec0) return false; // fec0::/10 deprecated site-local
  if ((groups[0]! & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return false; // NAT64 translation prefixes
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return false;
  if (groups[0] === 0x2001 && groups[1] === 0) return false; // Teredo/IETF protocol assignments
  if (groups[0] === 0x2001 && groups[1] === 2) return false; // benchmarking
  if (groups[0] === 0x2001 && (groups[1]! & 0xfff0) === 0x0010) return false; // ORCHID
  if (groups[0] === 0x2001 && (groups[1]! & 0xfff0) === 0x0020) return false; // ORCHIDv2
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  if (groups[0] === 0x2002 || groups[0] === 0x3ffe) return false; // 6to4 / 6bone address ranges
  return true;
}
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}
function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal")
  );
}

const IDN_SCRIPT_TESTS = [
  ["Latin", /\p{Script_Extensions=Latin}/u],
  ["Cyrillic", /\p{Script_Extensions=Cyrillic}/u],
  ["Greek", /\p{Script_Extensions=Greek}/u],
  ["Han", /\p{Script_Extensions=Han}/u],
  ["Hiragana", /\p{Script_Extensions=Hiragana}/u],
  ["Katakana", /\p{Script_Extensions=Katakana}/u],
  ["Hangul", /\p{Script_Extensions=Hangul}/u],
  ["Bopomofo", /\p{Script_Extensions=Bopomofo}/u],
  ["Arabic", /\p{Script_Extensions=Arabic}/u],
  ["Hebrew", /\p{Script_Extensions=Hebrew}/u],
  ["Devanagari", /\p{Script_Extensions=Devanagari}/u],
] as const;
const IDN_INVISIBLE_OR_BIDI = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const EAST_ASIAN_SCRIPT_COMBINATIONS = [
  new Set(["Han", "Hiragana", "Katakana"]),
  new Set(["Han", "Hangul"]),
  new Set(["Han", "Bopomofo"]),
];

function isSubset<T>(values: Set<T>, permitted: Set<T>): boolean {
  return [...values].every((value) => permitted.has(value));
}

/**
 * Conservative UTS #39-style mixed-script check for security-sensitive hosts.
 * WHATWG/ICU performs IDNA conversion; this adds round-trip, invisible/bidi,
 * mixed-number, and per-label mixed-script rejection before egress.
 */
export function hasAmbiguousIdnLabel(hostname: string): boolean {
  const ascii = domainToASCII(hostname.toLowerCase().replace(/\.$/, ""));
  if (!ascii) return true;
  const unicode = domainToUnicode(ascii);
  if (!unicode || domainToASCII(unicode) !== ascii) return true;
  for (const label of unicode.split(".")) {
    if (!label || IDN_INVISIBLE_OR_BIDI.test(label)) return true;
    if ([...label].some((character) => /\p{Decimal_Number}/u.test(character) && !/[0-9]/.test(character))) {
      return true;
    }
    const scripts = new Set<string>();
    for (const character of label) {
      if (!/\p{Letter}/u.test(character)) continue;
      const matched = IDN_SCRIPT_TESTS.find(([, expression]) => expression.test(character));
      scripts.add(matched?.[0] ?? "Other");
    }
    if (
      scripts.size > 1
      && !EAST_ASIAN_SCRIPT_COMBINATIONS.some((permitted) => isSubset(scripts, permitted))
    ) return true;
  }
  return false;
}

export function validatePublicHttpUrl(
  raw: string,
  options: PublicHttpUrlOptions = {},
): { ok: true; url: URL } | { ok: false; reason: string } {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "URL is required" };
  const maxUrlLength = boundedInteger(
    options.maxUrlLength,
    DEFAULT_MAX_URL_LENGTH,
    1,
    65_536,
  );
  if (value.length > maxUrlLength) {
    return { ok: false, reason: "URL is too long" };
  }
  const url = URL.parse(value);
  if (!url) return { ok: false, reason: "Invalid URL" };
  if (url.username || url.password) {
    return { ok: false, reason: "URL credentials are not allowed" };
  }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    return { ok: false, reason: options.allowHttp ? "Only HTTP(S) URLs are allowed" : "HTTPS is required" };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) return { ok: false, reason: "URL host is required" };
  if (isLocalHostname(hostname) && !options.allowLocalhost) {
    return { ok: false, reason: "Local and internal hosts are not allowed" };
  }
  const family = isIP(hostname);
  if (!family && hasAmbiguousIdnLabel(hostname)) {
    return { ok: false, reason: "Ambiguous or mixed-script internationalized hostnames are not allowed" };
  }
  if (family && !isPublicIpAddress(hostname) && !options.allowLocalhost) {
    return { ok: false, reason: "Private, local, and reserved IP addresses are not allowed" };
  }
  url.hash = "";
  return { ok: true, url };
}
function abortReason(signal: AbortSignal, timeoutMs: number): Error {
  const reason = signal.reason;
  if (reason instanceof Error && reason.name !== "TimeoutError") return reason;
  return new Error(`Outbound request exceeded ${timeoutMs}ms total duration`, { cause: reason });
}

async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) throw abortReason(signal, timeoutMs);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal, timeoutMs));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function resolvePublicAddress(
  hostname: string,
  options: PublicHttpUrlOptions,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ResolvedAddress> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(host);
  if (literalFamily) {
    if (!isPublicIpAddress(host) && !options.allowLocalhost) {
      throw new OutboundTargetRejectedError(`Outbound host resolved to a non-public address: ${host}`);
    }
    return { address: host, family: literalFamily as AddressFamily };
  }
  const rows = await raceWithSignal(
    lookup(host, { all: true, verbatim: true }),
    signal,
    timeoutMs,
  );
  if (rows.length === 0) throw new Error(`Outbound host did not resolve: ${host}`);
  const addresses = rows.map((row) => ({ address: row.address, family: row.family as AddressFamily }));
  if (!options.allowLocalhost) {
    const blocked = addresses.find((row) => !isPublicIpAddress(row.address));
    if (blocked) {
      throw new OutboundTargetRejectedError(`Outbound host resolved to a non-public address: ${blocked.address}`);
    }
  }
  addresses.sort((a, b) => a.family - b.family);
  const selected = addresses[0];
  if (!selected) throw new Error(`Outbound host did not resolve: ${host}`);
  return selected;
}
function requestBodyBytes(body: string | Uint8Array | undefined): Buffer | undefined {
  if (body === undefined) return undefined;
  return typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
}
function validatedCallerHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const validated: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) throw new OutboundTargetRejectedError("Outbound header name is empty");
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
    } catch (error) {
      throw new OutboundTargetRejectedError(`Invalid outbound header: ${name}`, { cause: error });
    }
    if (MANAGED_REQUEST_HEADERS.has(normalized)) {
      throw new OutboundTargetRejectedError(`Outbound header is managed internally: ${name}`);
    }
    validated[name] = value;
  }
  return validated;
}
export function stripCrossOriginSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  // Redirects can cross an administrative trust boundary. Preserve only a small
  // explicit set of representation, conditional, range, and tracing headers;
  // every provider-specific header is treated as confidential by default.
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) =>
      CROSS_ORIGIN_REDIRECT_SAFE_HEADERS.has(name.toLowerCase()),
    ),
  );
}
function singleRequest(
  url: URL,
  resolved: ResolvedAddress,
  options: OutboundHttpRequestOptions,
): Promise<OutboundHttpResponse> {
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 300_000);
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1,
    67_108_864,
  );
  const body = requestBodyBytes(options.body);
  const maxRequestBytes = boundedInteger(
    options.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
    1,
    16_777_216,
  );
  if (body && body.byteLength > maxRequestBytes) {
    throw new Error(`Outbound request body exceeds ${maxRequestBytes} bytes`);
  }
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.1",
    "User-Agent": "AgentRanking-Outbound/1.0",
    ...validatedCallerHeaders(options.headers),
    "Accept-Encoding": "identity",
    Host: url.host,
  };
  if (body) headers["Content-Length"] = String(body.byteLength);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const abortError = (cause?: unknown): unknown => {
    if (signal.reason === timeoutSignal.reason) {
      return new Error(`Outbound request exceeded ${timeoutMs}ms total duration`, {
        cause,
      });
    }
    return options.signal?.reason ?? cause ?? new DOMException("Aborted", "AbortError");
  };
  if (options.signal?.aborted) {
    return Promise.reject(abortError());
  }
  const requestOptions: RequestOptions = {
    protocol: url.protocol,
    hostname: resolved.address,
    family: resolved.family,
    port: url.port ? Number.parseInt(url.port, 10) : undefined,
    method: options.method ?? "GET",
    path: `${url.pathname}${url.search}`,
    headers,
    maxHeaderSize: 16 * 1024,
    signal,
    ...(url.protocol === "https:" && !isIP(url.hostname)
      ? { servername: url.hostname }
      : {}),
  };
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req: ClientRequest = client.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let truncated = false;
      let ended = false;
      const rawLength = Array.isArray(res.headers["content-length"])
        ? res.headers["content-length"][0]
        : res.headers["content-length"];
      const declaredLength = typeof rawLength === "string" && /^\d+$/.test(rawLength.trim())
        ? Number(rawLength)
        : null;
      const responseMayHaveBody =
        (options.method ?? "GET").toUpperCase() !== "HEAD" &&
        res.statusCode !== 204 &&
        res.statusCode !== 304 &&
        !((res.statusCode ?? 0) >= 100 && (res.statusCode ?? 0) < 200);
      const incompleteResponseError = (cause?: unknown) =>
        new Error(
          declaredLength === null
            ? `Outbound response connection closed after ${total} bytes before the message completed`
            : `Outbound response connection closed after ${total} bytes; Content-Length declared ${declaredLength}`,
          cause === undefined ? undefined : { cause },
        );
      const finish = () => {
        if (settled) return;
        if (signal.aborted) {
          rejectOnce(abortError());
          return;
        }
        if (
          !truncated &&
          responseMayHaveBody &&
          declaredLength !== null &&
          total !== declaredLength
        ) {
          rejectOnce(incompleteResponseError());
          return;
        }
        settled = true;
        const bodyBytes = Buffer.concat(chunks, total);
        resolve({
          url: url.toString(),
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: bodyBytes.toString("utf8"),
          bodyBytes,
          truncated,
        });
      };
      if (
        declaredLength !== null &&
        (!Number.isSafeInteger(declaredLength) || declaredLength > maxResponseBytes)
      ) {
        truncated = true;
        res.destroy();
        finish();
        return;
      }
      res.on("data", (chunk: Buffer | string) => {
        if (truncated) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = Math.max(0, maxResponseBytes - total);
        if (bytes.byteLength > remaining) {
          if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
          total += remaining;
          truncated = true;
          res.destroy();
          return;
        }
        chunks.push(bytes);
        total += bytes.byteLength;
      });
      res.on("end", () => {
        ended = true;
        finish();
      });
      res.on("aborted", () => {
        if (!settled && !truncated) rejectOnce(incompleteResponseError());
      });
      res.on("close", () => {
        if (settled) return;
        if (truncated) {
          finish();
          return;
        }
        if (!ended || !res.complete) {
          rejectOnce(incompleteResponseError());
        }
      });
      res.on("error", (error) => {
        if (truncated) {
          finish();
          return;
        }
        if (
          !ended ||
          !res.complete ||
          (declaredLength !== null && total !== declaredLength)
        ) {
          rejectOnce(incompleteResponseError(error));
          return;
        }
        rejectOnce(error);
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Outbound request was idle for ${timeoutMs}ms`));
    });
    req.on("error", (error) => {
      if (!signal.aborted) {
        rejectOnce(error);
        return;
      }
      rejectOnce(abortError(error));
    });
    if (body) req.write(body);
    req.end();
  });
}
function redirectUrl(current: URL, response: OutboundHttpResponse): URL | null {
  if (!REDIRECT_STATUSES.has(response.status)) return null;
  const location = Array.isArray(response.headers.location)
    ? response.headers.location[0]
    : response.headers.location;
  if (!location) return null;
  const next = URL.parse(location, current.href);
  if (!next) {
    throw new OutboundTargetRejectedError("Remote redirect location is invalid");
  }
  return next;
}
export async function requestPublicHttp(
  rawUrl: string,
  options: OutboundHttpRequestOptions = {},
): Promise<OutboundHttpResponse> {
  let method = (options.method ?? "GET").toUpperCase();
  let body = options.body;
  const initialBody = requestBodyBytes(body);
  const maxRequestBytes = boundedInteger(
    options.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
    1,
    16_777_216,
  );
  if (initialBody && initialBody.byteLength > maxRequestBytes) {
    throw new Error(`Outbound request body exceeds ${maxRequestBytes} bytes`);
  }

  const totalTimeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 300_000);
  const timeoutSignal = AbortSignal.timeout(totalTimeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const deadline = Date.now() + totalTimeoutMs;
  const remainingMs = (): number => {
    if (signal.aborted) throw abortReason(signal, totalTimeoutMs);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw abortReason(timeoutSignal, totalTimeoutMs);
    return remaining;
  };

  let currentRaw = rawUrl;
  let requestHeaders = validatedCallerHeaders(options.headers);
  const maxRedirects = boundedInteger(options.maxRedirects, 0, 0, 5);
  for (let redirectCount = 0; ; redirectCount += 1) {
    remainingMs();
    const validated = validatePublicHttpUrl(currentRaw, options);
    if (!validated.ok) throw new OutboundTargetRejectedError(validated.reason);
    const current = validated.url;
    const resolved = await resolvePublicAddress(
      current.hostname,
      options,
      signal,
      totalTimeoutMs,
    );
    const response = await singleRequest(current, resolved, {
      ...options,
      headers: requestHeaders,
      signal,
      timeoutMs: remainingMs(),
      method,
      body,
    });
    const next = redirectUrl(current, response);
    if (!next) return response;
    if (redirectCount >= maxRedirects) {
      throw new OutboundTargetRejectedError(
        `Outbound request exceeded ${maxRedirects} redirect${maxRedirects === 1 ? "" : "s"}`,
      );
    }
    if (method !== "GET" && method !== "HEAD") {
      throw new OutboundTargetRejectedError(
        "Redirects are not allowed for outbound requests with a body",
      );
    }
    if (current.origin !== next.origin) {
      requestHeaders = stripCrossOriginSensitiveHeaders(requestHeaders);
    }
    currentRaw = next.toString();
    if (method !== "HEAD") method = "GET";
    body = undefined;
  }
}

export async function fetchPublicJson<T>(
  rawUrl: string,
  options: Omit<OutboundHttpRequestOptions, "method" | "body"> = {},
): Promise<T> {
  const response = await requestPublicHttp(rawUrl, {
    ...options,
    method: "GET",
    maxRedirects: options.maxRedirects ?? 3,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Remote URL returned HTTP ${response.status}`);
  }
  if (response.truncated) {
    const maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1,
      67_108_864,
    );
    throw new Error(`Remote response exceeded ${maxResponseBytes} bytes`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(response.bodyBytes);
  } catch (error) {
    throw new Error("Remote JSON response is not valid UTF-8", { cause: error });
  }
  return JSON.parse(text) as T;
}
