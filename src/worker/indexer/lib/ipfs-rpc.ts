import { parseOptionalContentLength } from "./strict-integer.js";
import { CID } from "multiformats/cid";
import { base32 } from "multiformats/bases/base32";
import { config } from "../config.js";
import { isIP } from "node:net";
import { redactSensitiveText } from "./secret-redaction.js";
import { deadlineSignal, throwIfAborted } from "./abort.js";
export type ParsedIpfsReference = {
  originalUri: string;
  cid: CID;
  canonicalCid: string;
  path: string;
  normalizedUri: string;
  codec: number;
  multihashCode: number;
  multihashDigestHex: string;
};
export type IpfsByteResponse = ParsedIpfsReference & {
  bytes: Uint8Array;
  retrievalMethod: "cat" | "dag-get";
};
export type KuboFailureClass = "authentication" | "authorization" | "unsupported_method" | "rate_limit" | "transient" | "malformed" | "oversized" | "configuration";
export class KuboRpcError extends Error {
  constructor(readonly classification: KuboFailureClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KuboRpcError";
  }
}
const ALLOWED_KUBO_COMMANDS = new Set(["cat", "dag/get"]);
function normalizedIpHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase().split("%", 1)[0] ?? "";
}
function isLoopbackHost(hostname: string): boolean {
  const host = normalizedIpHost(hostname);
  return host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}
function isPrivateTunnelIp(hostname: string): boolean {
  const host = normalizedIpHost(hostname);
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10
      || (a === 172 && b !== undefined && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  return isIP(host) === 6 && /^(?:fc|fd)[0-9a-f]{2}:/i.test(host);
}
function validateKuboTransport(raw: string): URL {
  const url = new URL(raw);
  const tokenLength = config.ipfsApiBearerToken?.trim().length ?? 0;
  if (url.username || url.password) throw new KuboRpcError("configuration", "Kubo URL credentials are not allowed");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new KuboRpcError("configuration", "Kubo RPC must use HTTP or HTTPS");
  if (url.protocol === "http:"
    && !isLoopbackHost(url.hostname)
    && !(config.ipfsApiAllowPrivateHttpTunnel && tokenLength >= 32 && isPrivateTunnelIp(url.hostname))) {
    throw new KuboRpcError("configuration", "Remote Kubo RPC must use HTTPS; plain HTTP is limited to loopback or an explicitly approved authenticated RFC1918/ULA tunnel address");
  }
  return url;
}
function normalizeApiBase(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = validateKuboTransport(raw);
    const path = url.pathname.replace(/\/+$/, "");
    if (path && path.toLowerCase() !== "/api/v0") return null;
    return url.origin;
  } catch (error) {
    if (error instanceof KuboRpcError) throw error;
    return null;
  }
}
function decodePath(raw: string): string {
  const segments = raw.split("/").filter(Boolean).map((segment) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { throw new Error("Invalid percent encoding in IPFS path"); }
    if (!decoded || decoded === "." || decoded === ".." || /[\\/\0]/.test(decoded)) {
      throw new Error("Unsafe IPFS path segment");
    }
    return encodeURIComponent(decoded);
  });
  return segments.join("/");
}
function splitCandidate(value: string): { root: string; path: string } {
  const raw = value.trim();
  if (!raw) throw new Error("Empty IPFS reference");
  if (/^ipfs:\/\//i.test(raw)) {
    const undecorated = raw.slice(7).replace(/^ipfs\//i, "").split(/[?#]/, 1)[0] ?? "";
    const [root = "", ...rest] = undecorated.split("/");
    return { root, path: decodePath(rest.join("/")) };
  }
  try {
    const url = new URL(raw);
    const labels = url.hostname.toLowerCase().split(".");
    if (labels.length >= 3 && labels[1] === "ipfs") {
      return { root: labels[0] ?? "", path: decodePath(url.pathname) };
    }
    const match = /\/ipfs\/([^/?#]+)([^?#]*)/i.exec(url.pathname);
    if (match) return { root: match[1] ?? "", path: decodePath(match[2] ?? "") };
  } catch {
    // A bare CID or CID/path is supported below.
  }
  const undecorated = raw.split(/[?#]/, 1)[0] ?? "";
  const [root = "", ...rest] = undecorated.replace(/^\/+/, "").split("/");
  return { root, path: decodePath(rest.join("/")) };
}
export function parseIpfsReference(value: string): ParsedIpfsReference {
  const { root, path } = splitCandidate(value);
  let cid: CID;
  try { cid = CID.parse(root); } catch (error) { throw new Error("Invalid IPFS CID", { cause: error }); }
  const canonical = cid.toV1().toString(base32);
  return {
    originalUri: value,
    cid,
    canonicalCid: canonical,
    path,
    normalizedUri: `ipfs://${canonical}${path ? `/${path}` : ""}`,
    codec: cid.code,
    multihashCode: cid.multihash.code,
    multihashDigestHex: Buffer.from(cid.multihash.digest).toString("hex"),
  };
}
export function isIpfsReference(value: string): boolean {
  try { parseIpfsReference(value); return true; } catch { return false; }
}
async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = parseOptionalContentLength(response.headers.get("content-length"), "Kubo Content-Length");
  if (contentLength != null && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`IPFS response exceeds ${maxBytes} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`IPFS response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  if (contentLength != null && total !== contentLength) {
    throw new Error(
      `IPFS response ended after ${total} bytes; Content-Length declared ${contentLength}`,
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function kuboHeaders(): Headers {
  const headers = new Headers({ Accept: "application/octet-stream" });
  const token = config.ipfsApiBearerToken?.trim();
  if (process.env.NODE_ENV === "production" && (!token || token.length < 32)) {
    throw new Error("IPFS_API_BEARER_TOKEN must contain at least 32 characters for worker IPFS reads in production");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
async function kuboCall(command: string, arg: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (!ALLOWED_KUBO_COMMANDS.has(command)) throw new KuboRpcError("unsupported_method", "Kubo RPC method is not allowlisted");
  const apiBase = normalizeApiBase(config.ipfsApiUrl);
  if (!apiBase) throw new KuboRpcError("configuration", "IPFS_API_URL is not configured for the worker");
  const query = new URLSearchParams({ arg });
  if (command === "cat") query.set("length", String(maxBytes + 1));
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/v0/${command}?${query}`, {
      method: "POST",
      headers: kuboHeaders(),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: deadlineSignal(config.ipfsRpcReadTimeoutMs, signal),
    });
  } catch (error) {
    throw new KuboRpcError("transient", `Private Kubo ${command} RPC is unreachable`, { cause: error });
  }
  if (!response.ok) {
    let detail = "";
    try { detail = redactSensitiveText(new TextDecoder().decode(await readBoundedBytes(response, 4_096))).replace(/\s+/g, " ").trim().slice(0, 300); } catch {}
    const classification: KuboFailureClass = response.status === 401 ? "authentication"
      : response.status === 403 ? "authorization"
      : response.status === 404 || response.status === 405 ? "unsupported_method"
      : response.status === 429 ? "rate_limit"
      : response.status >= 500 ? "transient"
      : "configuration";
    throw new KuboRpcError(classification, `Private Kubo ${command} RPC returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  try { return await readBoundedBytes(response, maxBytes); }
  catch (error) {
    if (error instanceof Error && /exceeds/i.test(error.message)) throw new KuboRpcError("oversized", error.message, { cause: error });
    throw new KuboRpcError("malformed", `Private Kubo ${command} returned an unreadable body`, { cause: error });
  }
}
export async function fetchIpfsBytes(value: string, signal?: AbortSignal): Promise<IpfsByteResponse> {
  throwIfAborted(signal);
  const parsed = parseIpfsReference(value);
  const arg = `/ipfs/${parsed.canonicalCid}${parsed.path ? `/${parsed.path}` : ""}`;
  const fileLike = parsed.codec === 0x55 || parsed.codec === 0x70; // raw or dag-pb/UnixFS
  const retrievalMethod = fileLike ? "cat" : "dag-get";
  if (!fileLike && parsed.path) {
    throw new Error("IPLD path retrieval for structured codecs is not supported without explicit selector semantics");
  }
  const bytes = await kuboCall(fileLike ? "cat" : "dag/get", arg, config.ipfsRpcMaxResponseBytes, signal);
  return { ...parsed, bytes, retrievalMethod };
}
/** Compatibility wrapper. New registration code consumes bytes through the common lossless decoder. */
export async function fetchIpfsJson<T>(value: string, signal?: AbortSignal): Promise<T> {
  const result = await fetchIpfsBytes(value, signal);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
  return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
}
