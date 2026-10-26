import "server-only";
import { buildIpfsGatewayUrl } from "@/lib/ipfs/uri";
import { normalizePublicIpfsGateway } from "./public-gateway-config.mjs";
import { assertKuboRpcContentAvailable } from "@/lib/ipfs/rpc-http";
import { CID } from "multiformats/cid";
import { isIP } from "node:net";
export type KuboConfig = {
  apiUrl: string | null;
  publicGatewayUrl: string | null;
  bearerTokenConfigured: boolean;
  timeoutMs: number;
  readTimeoutMs: number;
  maxReadResponseBytes: number;
  maxAddBytes: number;
};
function normalizedIpHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase().split("%", 1)[0] ?? "";
}
function isLoopbackHost(hostname: string): boolean {
  const host = normalizedIpHost(hostname);
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "::1"
    || (isIP(host) === 4 && host.startsWith("127."));
}
function isPrivateTunnelIp(hostname: string): boolean {
  const host = normalizedIpHost(hostname);
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    const [a, b] = parts;
    return a === 10
      || (a === 172 && b !== undefined && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  return isIP(host) === 6 && /^(?:fc|fd)[0-9a-f]{2}:/i.test(host);
}
function allowAuthenticatedPrivateHttpTunnel(hostname: string): boolean {
  const enabled = process.env.IPFS_API_ALLOW_PRIVATE_HTTP_TUNNEL?.trim().toLowerCase();
  const token = process.env.IPFS_API_BEARER_TOKEN?.trim() ?? "";
  return (enabled === "1" || enabled === "true")
    && token.length >= 32
    && isPrivateTunnelIp(hostname);
}
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
function optionalHttpUrl(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`${name} must use http:// or https://`);
    }
    if (
      url.protocol === "http:"
      && !isLoopbackHost(url.hostname)
      && !allowAuthenticatedPrivateHttpTunnel(url.hostname)
    ) {
      throw new Error(
        `${name} must use HTTPS unless it targets loopback or an explicitly approved authenticated private tunnel`,
      );
    }
    if (url.username || url.password) {
      throw new Error(`${name} must not contain URL credentials; use IPFS_API_BEARER_TOKEN for RPC authentication`);
    }
    url.hash = "";
    url.search = "";
    return trimTrailingSlash(url.toString());
  } catch (error) {
    throw new Error(
      `${name} is invalid: ${Error.isError(error) ? error.message : String(error)}`,
    );
  }
}
function optionalGatewayUrl(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  return (
    normalizePublicIpfsGateway(raw, {
      name,
      production: process.env.NODE_ENV === "production",
    }) || null
  );
}
function resolveBoundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function normalizeApiUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (path && path.toLowerCase() !== "/api/v0") {
    throw new Error("IPFS_API_URL path must be empty or /api/v0");
  }
  return url.origin;
}
export function getKuboConfig(): KuboConfig {
  const publicGatewayUrl = optionalGatewayUrl("IPFS_GATEWAY_URL");
  const bearerToken = process.env.IPFS_API_BEARER_TOKEN?.trim() ?? "";
  return {
    apiUrl: normalizeApiUrl(optionalHttpUrl("IPFS_API_URL")),
    publicGatewayUrl,
    bearerTokenConfigured: bearerToken.length >= 32,
    timeoutMs: resolveBoundedInteger("IPFS_API_TIMEOUT_MS", 60_000, 1_000, 300_000),
    readTimeoutMs: resolveBoundedInteger(
      "IPFS_RPC_READ_TIMEOUT_MS",
      22_000,
      1_000,
      120_000,
    ),
    maxReadResponseBytes: resolveBoundedInteger(
      "IPFS_RPC_MAX_RESPONSE_BYTES",
      1_048_576,
      16_384,
      16_777_216,
    ),
    maxAddBytes: resolveBoundedInteger(
      "IPFS_RPC_MAX_ADD_BYTES",
      8_388_608,
      1_024,
      67_108_864,
    ),
  };
}
function requireKuboApiUrl(): string {
  const { apiUrl } = getKuboConfig();
  if (!apiUrl) {
    throw new Error(
      "Remote Kubo API is not configured. Set IPFS_API_URL to the Kubo RPC address reachable over the private VPS network.",
    );
  }
  return apiUrl;
}
function requirePublicGatewayUrl(): string {
  const { publicGatewayUrl } = getKuboConfig();
  if (!publicGatewayUrl) {
    throw new Error(
      "The self-hosted public IPFS gateway is not configured. Set IPFS_GATEWAY_URL to the HTTPS gateway base ending in /ipfs.",
    );
  }
  return publicGatewayUrl;
}
function kuboApiUrl(path: string, query?: URLSearchParams): string {
  const suffix = query?.toString();
  return `${requireKuboApiUrl()}${path}${suffix ? `?${suffix}` : ""}`;
}
function kuboApiHeaders(): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const token = process.env.IPFS_API_BEARER_TOKEN?.trim();
  if (process.env.NODE_ENV === "production" && (!token || token.length < 32)) {
    throw new Error(
      "IPFS_API_BEARER_TOKEN must contain at least 32 characters in production and match Kubo API.Authorizations",
    );
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
function parseOptionalContentLength(value: string | null): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error("Remote Kubo returned an invalid Content-Length");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Remote Kubo returned an invalid Content-Length");
  }
  return parsed;
}
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = parseOptionalContentLength(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Remote Kubo response exceeds ${maxBytes} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Remote Kubo response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  if (contentLength !== null && total !== contentLength) {
    throw new Error(
      `Remote Kubo response ended after ${total} bytes; Content-Length declared ${contentLength}`,
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Remote Kubo returned invalid UTF-8");
  }
}
function canonicalCid(value: unknown): string | null {
  const candidate = typeof value === "string"
    ? value.trim()
    : value && typeof value === "object" && typeof (value as { "/"?: unknown })["/"] === "string"
      ? ((value as { "/": string })["/"].trim())
      : "";
  if (!candidate) return null;
  try {
    return CID.parse(candidate).toV1().toString();
  } catch {
    return null;
  }
}
function cidFromAddResponse(body: string): string | null {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const cid = canonicalCid(value.Hash ?? value.Cid ?? value.cid);
      if (cid) return cid;
    } catch {
      // Kubo add streams NDJSON. Ignore non-JSON lines and keep looking.
    }
  }
  return null;
}
export function kuboGatewayUrl(cidOrUri: string): string {
  const url = buildIpfsGatewayUrl(requirePublicGatewayUrl(), cidOrUri);
  if (!url) throw new Error("Invalid IPFS CID or URI");
  return url;
}
export async function assertKuboContentAvailable(
  cidOrUri: string,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const config = getKuboConfig();
  await assertKuboRpcContentAvailable(cidOrUri, {
    apiUrl: config.apiUrl,
    bearerToken: process.env.IPFS_API_BEARER_TOKEN,
    timeoutMs: options.timeoutMs ?? Math.min(config.readTimeoutMs, 15_000),
  });
}
export async function addBytesToKubo(input: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  pin?: boolean;
}): Promise<{ cid: string; uri: string; gatewayUrl: string }> {
  const config = getKuboConfig();
  if (input.bytes.byteLength === 0) throw new Error("Cannot add an empty IPFS object");
  if (input.bytes.byteLength > config.maxAddBytes) {
    throw new Error(
      `IPFS object exceeds the configured ${config.maxAddBytes}-byte add limit`,
    );
  }
  const filename = input.filename.trim().replace(/[\/\\]/g, "_").slice(0, 255);
  if (!filename) throw new Error("IPFS filename is required");
  const contentType = input.contentType.trim().slice(0, 255);
  if (!contentType || /[\r\n]/.test(contentType)) throw new Error("Invalid IPFS content type");
  const form = new FormData();
  const blobBytes = new Uint8Array(input.bytes.byteLength);
  blobBytes.set(input.bytes);
  form.append("file", new Blob([blobBytes.buffer], { type: contentType }), filename);
  const query = new URLSearchParams({
    pin: input.pin === false ? "false" : "true",
    "cid-version": "1",
    "raw-leaves": "true",
    "wrap-with-directory": "false",
  });
  const url = kuboApiUrl("/api/v0/add", query);
  const headers = kuboApiHeaders();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: form,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new Error("Remote Kubo RPC is unreachable", { cause: error });
  }
  const body = await readBoundedText(response, 65_536);
  if (!response.ok) {
    throw new Error(`Remote Kubo add failed (${response.status}): ${body.slice(0, 300)}`);
  }
  const cid = cidFromAddResponse(body);
  if (!cid) throw new Error("Remote Kubo add succeeded but returned no CID");
  return { cid, uri: `ipfs://${cid}`, gatewayUrl: kuboGatewayUrl(cid) };
}
export async function addJsonToKubo(
  filename: string,
  value: unknown,
): Promise<{ cid: string; uri: string; gatewayUrl: string }> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("IPFS JSON value is not serializable");
  const bytes = new TextEncoder().encode(serialized);
  return addBytesToKubo({ bytes, filename, contentType: "application/json", pin: true });
}
export async function checkKuboReady(): Promise<{
  ready: boolean;
  bearerTokenConfigured: boolean;
  version?: string;
  reason?: string;
}> {
  const config = getKuboConfig();
  const base = { bearerTokenConfigured: config.bearerTokenConfigured };
  if (!config.apiUrl || !config.publicGatewayUrl) {
    return {
      ...base,
      ready: false,
      reason: "Remote Kubo requires IPFS_API_URL and IPFS_GATEWAY_URL.",
    };
  }
  if (process.env.NODE_ENV === "production" && !config.bearerTokenConfigured) {
    return {
      ...base,
      ready: false,
      reason: "IPFS_API_BEARER_TOKEN must contain at least 32 characters in production",
    };
  }
  if (process.env.NODE_ENV === "production" && new URL(config.publicGatewayUrl).protocol !== "https:") {
    return {
      ...base,
      ready: false,
      reason: "IPFS_GATEWAY_URL must use HTTPS in production",
    };
  }
  try {
    const response = await fetch(kuboApiUrl("/api/v0/version"), {
      method: "POST",
      headers: kuboApiHeaders(),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 10_000)),
    });
    const body = await readBoundedText(response, 16_384);
    if (!response.ok) {
      return {
        ...base,
        ready: false,
        reason: `Remote Kubo version check failed with HTTP ${response.status}`,
      };
    }
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return { ...base, ready: false, reason: "Remote Kubo returned invalid version JSON" };
    }
    const version = data && typeof data === "object" && !Array.isArray(data)
      ? (data as { Version?: unknown }).Version
      : undefined;
    if (typeof version !== "string" || !version.trim()) {
      return { ...base, ready: false, reason: "Remote Kubo version response omitted Version" };
    }
    return { ...base, ready: true, version: version.trim() };
  } catch (error) {
    console.warn("[Kubo readiness] private RPC health check failed", error);
    return {
      ...base,
      ready: false,
      reason: "Remote Kubo RPC health check failed",
    };
  }
}
