import { requestPublicHttp } from "@/lib/outbound-http";
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const BLOCKED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "expect",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);
const MAX_REQUEST_BODY_BYTES = 262_144;
const MAX_RESPONSE_BODY_BYTES = 1_048_576;
export type DashboardProxyInput = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};
export type DashboardProxyResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: unknown;
  latencyMs: number;
  truncated: boolean;
  finalUrl: string;
};
function sanitizedHeaders(input: Record<string, string> | undefined): Record<string, string> {
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input))) {
    throw new Error("headers must be an object of string values");
  }
  const headers: Record<string, string> = {};
  let accepted = 0;
  for (const [rawName, rawValue] of Object.entries(input ?? {})) {
    const name = rawName.trim();
    if (!name || typeof rawValue !== "string") continue;
    if (BLOCKED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    if (name.length > 128 || rawValue.length > 8_192) continue;
    accepted += 1;
    if (accepted > 64) throw new Error("Too many request headers");
    headers[name] = rawValue;
  }
  return headers;
}
function responseHeaders(input: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(input)) {
    if (name.toLowerCase() === "set-cookie" || rawValue === undefined) continue;
    result[name] = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
  }
  return result;
}
export async function executeDashboardProxyRequest(
  input: DashboardProxyInput,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<DashboardProxyResult> {
  if (input.method !== undefined && typeof input.method !== "string") {
    throw new Error("method must be a string");
  }
  if (input.body !== undefined && typeof input.body !== "string") {
    throw new Error("body must be a string");
  }
  const method = (input.method ?? "GET").trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error("Unsupported HTTP method");
  const body = method === "GET" || method === "HEAD" ? undefined : input.body;
  if (body !== undefined && Buffer.byteLength(body, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new Error(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
  }
  const started = Date.now();
  const response = await requestPublicHttp(String(input.url ?? ""), {
    method,
    signal,
    headers: sanitizedHeaders(input.headers),
    body,
    timeoutMs,
    maxRequestBytes: MAX_REQUEST_BODY_BYTES,
    maxResponseBytes: MAX_RESPONSE_BODY_BYTES,
    maxRedirects: method === "GET" || method === "HEAD" ? 3 : 0,
    allowHttp: process.env.NODE_ENV !== "production",
    allowLocalhost: process.env.NODE_ENV !== "production",
  });
  let json: unknown = null;
  if (!response.truncated && response.body) {
    try {
      json = JSON.parse(response.body) as unknown;
    } catch {
      json = null;
    }
  }
  return {
    status: response.status,
    headers: responseHeaders(response.headers),
    body: response.body,
    json,
    latencyMs: Date.now() - started,
    truncated: response.truncated,
    finalUrl: response.url,
  };
}
