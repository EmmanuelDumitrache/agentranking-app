import { isIP } from "node:net";
import { extractIpfsPath } from "./uri";
export type KuboRpcReadOptions = {
  apiUrl: string | null | undefined;
  bearerToken?: string | null;
  signal?: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
};
function boundedInteger(
  value: number,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
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
function privateHttpTunnelAllowed(hostname: string, bearerToken: string | null | undefined): boolean {
  const enabled = process.env.IPFS_API_ALLOW_PRIVATE_HTTP_TUNNEL?.trim().toLowerCase();
  return (enabled === "1" || enabled === "true")
    && (bearerToken?.trim().length ?? 0) >= 32
    && isPrivateTunnelIp(hostname);
}
function normalizeApiBase(
  value: string | null | undefined,
  bearerToken: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.protocol === "http:"
      && !isLoopbackHost(url.hostname)
      && !privateHttpTunnelAllowed(url.hostname, bearerToken)) return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (path && path.toLowerCase() !== "/api/v0") return null;
    return url.origin;
  } catch {
    return null;
  }
}
function rpcUrl(
  apiUrl: string | null | undefined,
  bearerToken: string | null | undefined,
  command: string,
  query: URLSearchParams,
): string {
  const base = normalizeApiBase(apiUrl, bearerToken);
  if (!base) throw new Error("IPFS_API_URL is not configured or is invalid");
  return `${base}/api/v0/${command}?${query.toString()}`;
}
function ipfsRpcArg(cidOrUri: string): string {
  const path = extractIpfsPath(cidOrUri);
  if (!path) throw new Error("Invalid IPFS CID, URI, or gateway URL");
  return `/ipfs/${path}`;
}
function rpcHeaders(bearerToken: string | null | undefined, accept: string): Headers {
  const headers = new Headers({ Accept: accept });
  const token = bearerToken?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
async function boundedErrorText(response: Response): Promise<string> {
  try {
    const bytes = await readResponseBytes(response, 4_096);
    return new TextDecoder().decode(bytes).replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}
function parseOptionalContentLength(value: string | null): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error("Kubo returned an invalid Content-Length");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Kubo returned an invalid Content-Length");
  }
  return parsed;
}
async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = parseOptionalContentLength(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`IPFS response exceeds the ${maxBytes}-byte limit`);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`IPFS response exceeds the ${maxBytes}-byte limit`);
    }
    chunks.push(value);
  }
  if (contentLength !== null && total !== contentLength) {
    throw new Error(
      `Kubo response ended after ${total} bytes; Content-Length declared ${contentLength}`,
    );
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
async function catResponse(
  cidOrUri: string,
  options: KuboRpcReadOptions,
  length: number,
  accept: string,
): Promise<Response> {
  const query = new URLSearchParams({
    arg: ipfsRpcArg(cidOrUri),
    length: String(length),
  });
  const url = rpcUrl(options.apiUrl, options.bearerToken, "cat", query);
  const headers = rpcHeaders(options.bearerToken, accept);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: options.signal
        ? AbortSignal.any([
            options.signal,
            AbortSignal.timeout(boundedInteger(options.timeoutMs, 15_000, 1, 300_000)),
          ])
        : AbortSignal.timeout(boundedInteger(options.timeoutMs, 15_000, 1, 300_000)),
    });
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    throw new Error("Remote Kubo cat RPC is unreachable", { cause: error });
  }
  if (!response.ok) {
    const detail = await boundedErrorText(response);
    throw new Error(
      `Remote Kubo cat failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return response;
}
/** Retrieve bounded UnixFS/IPFS bytes through Kubo's private HTTP RPC `cat` command. */
export async function fetchBytesFromKuboRpc(
  cidOrUri: string,
  options: KuboRpcReadOptions,
): Promise<Uint8Array> {
  const maxBytes = boundedInteger(options.maxBytes, 1_048_576, 1, 16_777_216);
  // Ask Kubo for one byte beyond the accepted limit so an oversized object is
  // detected without downloading the entire file from the IPFS network.
  const response = await catResponse(cidOrUri, options, maxBytes + 1, "application/octet-stream");
  return readResponseBytes(response, maxBytes);
}
export async function fetchJsonFromKuboRpc<T>(
  cidOrUri: string,
  options: KuboRpcReadOptions,
): Promise<T> {
  const bytes = await fetchBytesFromKuboRpc(cidOrUri, options);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch (error) {
    throw new Error("Remote Kubo object is not valid UTF-8", { cause: error });
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Remote Kubo object is not valid JSON");
  }
}
/** Resolve and read at most one byte, proving this Kubo node can retrieve the CID. */
export async function assertKuboRpcContentAvailable(
  cidOrUri: string,
  options: Omit<KuboRpcReadOptions, "maxBytes">,
): Promise<void> {
  const response = await catResponse(cidOrUri, { ...options, maxBytes: 1 }, 1, "*/*");
  await readResponseBytes(response, 1);
}
