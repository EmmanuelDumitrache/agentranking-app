const KIB = 1024;
const MIB = 1024 * KIB;
export const DEFAULT_API_BODY_LIMIT_BYTES = 512 * KIB;
export const MAX_API_BODY_LIMIT_BYTES = 8 * MIB;
const BODYLESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DELETE_WITHOUT_LENGTH_METHODS = new Set(["DELETE"]);
function matchesPath(pathname: string, exactOrPrefix: string): boolean {
  return pathname === exactOrPrefix || pathname.startsWith(`${exactOrPrefix}/`);
}
/**
 * Maximum request-body size before a Next.js route is allowed to materialize
 * JSON or multipart data. Most API mutations are small control messages; only
 * explicitly identified ingestion/upload surfaces receive larger budgets.
 */
export function apiBodyLimitBytes(pathname: string, method: string): number | null {
  const normalizedMethod = method.trim().toUpperCase();
  if (BODYLESS_METHODS.has(normalizedMethod) || !pathname.startsWith("/api/")) {
    return null;
  }
  if (
    matchesPath(pathname, "/api/admin/upload/image") ||
    matchesPath(pathname, "/api/ads/upload") ||
    matchesPath(pathname, "/api/dashboard/uploads/token-image") ||
    matchesPath(pathname, "/api/upload/agent-image") ||
    matchesPath(pathname, "/api/public-launch/uploads/token-image") ||
    (/^\/api\/public-launch\/metaplex\/[^/]+\/upload-irys$/.test(pathname)) ||
    (/^\/api\/metaplex-launch\/attempts\/[^/]+\/upload-irys$/.test(pathname))
  ) {
    return MAX_API_BODY_LIMIT_BYTES;
  }
  if (matchesPath(pathname, "/api/dashboard/agents") && pathname.includes("/chat/stream")) {
    return 2_100_000;
  }
  if (
    matchesPath(pathname, "/api/webhooks/github") ||
    matchesPath(pathname, "/api/webhooks/helio") ||
    matchesPath(pathname, "/api/partners/orbit/agents") ||
    matchesPath(pathname, "/api/agents/register") ||
    matchesPath(pathname, "/api/admin/metaplex/bulk-index") ||
    matchesPath(pathname, "/api/agent-launch/metadata")
  ) {
    return 2 * MIB;
  }
  return DEFAULT_API_BODY_LIMIT_BYTES;
}
export type ApiBodyPolicyInput = {
  pathname: string;
  method: string;
  hasBody: boolean;
  contentLength: string | null;
};
export type ApiBodyPolicyResult =
  | { ok: true; limitBytes: number | null; declaredBytes: number | null }
  | { ok: false; status: 411 | 413; message: string; limitBytes: number };
/**
 * Request streams with no valid Content-Length are rejected before route code
 * calls request.json()/formData(). This prevents chunked requests from bypassing
 * byte limits and forcing unbounded buffering inside the framework parser.
 */
export function evaluateApiBodyPolicy(input: ApiBodyPolicyInput): ApiBodyPolicyResult {
  const limitBytes = apiBodyLimitBytes(input.pathname, input.method);
  if (limitBytes === null || !input.hasBody) {
    return { ok: true, limitBytes, declaredBytes: null };
  }
  const raw = input.contentLength?.trim() ?? "";
  if (!/^\d+$/.test(raw)) {
    if (
      DELETE_WITHOUT_LENGTH_METHODS.has(input.method.trim().toUpperCase())
      && !raw
    ) {
      return { ok: true, limitBytes, declaredBytes: 0 };
    }
    return {
      ok: false,
      status: 411,
      message: "Content-Length is required for API request bodies",
      limitBytes,
    };
  }
  const declaredBytes = Number(raw);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > limitBytes) {
    return {
      ok: false,
      status: 413,
      message: `Request body exceeds ${limitBytes} bytes`,
      limitBytes,
    };
  }
  return { ok: true, limitBytes, declaredBytes };
}