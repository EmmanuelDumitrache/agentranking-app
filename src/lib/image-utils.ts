import { browserIpfsGatewayUrl, extractIpfsPath } from "@/lib/ipfs/uri";
import { resolveUploadPublicUrl } from "@/lib/public-media-url";
const PRODUCTION_APP_ORIGIN = "https://app.agentranking.io";
const PRODUCTION_UPLOAD_HOSTS = new Set([
  "app.agentranking.io",
  "beta.agentranking.io",
  "agentranking.io",
  "www.agentranking.io",
]);
function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}
function rewriteProdUploadToLocal(trimmed: string): string | null {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const url = new URL(trimmed);
    if (
      PRODUCTION_UPLOAD_HOSTS.has(url.hostname.toLowerCase()) &&
      url.pathname.startsWith("/uploads/")
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return null;
  }
  return null;
}
/** Collapse absolute /uploads URLs to stable relative paths for PostgreSQL. */
export function normalizeStoredAgentImageUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.startsWith("/uploads/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.pathname.startsWith("/uploads/")) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (trimmed.startsWith("/")) return trimmed;
  return trimmed;
}
function rewriteLocalUploadUrl(trimmed: string): string | null {
  const prodLocal = rewriteProdUploadToLocal(trimmed);
  if (prodLocal) return prodLocal;
  try {
    const url = new URL(trimmed);
    if (
      process.env.NODE_ENV !== "production" ||
      !isLocalHostname(url.hostname) ||
      !url.pathname.startsWith("/uploads/")
    ) {
      return null;
    }
    return `${PRODUCTION_APP_ORIGIN}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
/** Host/path patterns that are HTML pages, not direct image assets. */
const NON_DIRECT_IMAGE_PATTERNS = [
  /\/wiki\/File:/i,
  /fandom\.com\/wiki\//i,
  /wikipedia\.org\/wiki\/File:/i,
] as const;
/** True when URL is unlikely to work as an `<img src>` (wiki file pages, etc.). */
export function isNonDirectImageUrl(uri: string): boolean {
  const trimmed = uri.trim();
  if (!trimmed) return true;
  try {
    const path = new URL(trimmed).pathname.toLowerCase();
    if (NON_DIRECT_IMAGE_PATTERNS.some((re) => re.test(trimmed))) return true;
    const last = path.split("/").pop() ?? "";
    if (last && !last.includes(".") && /\/wiki\//i.test(path)) return true;
  } catch {
    return false;
  }
  return false;
}
/**
 * Resolve agent image URLs to loadable URLs.
 * IPFS images always use the configured self-hosted public Kubo gateway.
 */
function isUnusableAgentImageRef(trimmed: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.startsWith("file://")) return true;
  if (!trimmed.includes("/") && !trimmed.includes(":")) return true;
  return false;
}
export function resolveImageUrl(uri: string | null | undefined): string | null {
  if (!uri || uri.trim() === "") return null;
  const trimmed = uri.trim();
  if (isUnusableAgentImageRef(trimmed)) return null;
  if (trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("blob:")) return trimmed;
  if (trimmed.startsWith("ar://")) {
    const txId = trimmed.replace("ar://", "");
    return `https://arweave.net/${txId}`;
  }
  if (trimmed.startsWith("/uploads/")) {
    if (process.env.NODE_ENV !== "production") {
      return trimmed;
    }
    return resolveUploadPublicUrl(trimmed) || trimmed;
  }
  if (trimmed.startsWith("/") && !trimmed.toLowerCase().startsWith("/ipfs/")) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const prodLocal = rewriteProdUploadToLocal(trimmed);
    if (prodLocal) return prodLocal;
    const rewrittenUpload = rewriteLocalUploadUrl(trimmed);
    if (rewrittenUpload) return rewrittenUpload;
    if (extractIpfsPath(trimmed)) {
      // Without a configured gateway (demo builds), keep the original HTTP gateway URL.
      return browserIpfsGatewayUrl(trimmed) ?? trimmed;
    }
    return isNonDirectImageUrl(trimmed) ? null : trimmed;
  }
  if (trimmed.toLowerCase().startsWith("ipfs://") || trimmed.toLowerCase().startsWith("/ipfs/")) {
    return browserIpfsGatewayUrl(trimmed);
  }
  return extractIpfsPath(trimmed) ? browserIpfsGatewayUrl(trimmed) : null;
}
export function sanitizeAgentImageUrl(uri: string | null | undefined): string {
  return resolveImageUrl(uri) ?? "";
}

/** Token/agent image preview — same-origin /uploads so local launchpad uploads actually render. */
export function resolveTokenImagePreviewUrl(uri: string | null | undefined): string {
  const trimmed = uri?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("/uploads/")) return trimmed;
  const resolved = resolveImageUrl(trimmed);
  if (!resolved) return trimmed;
  return rewriteProdUploadToLocal(resolved) ?? resolved;
}

/** If same-origin upload 404s (prod file) or prod URL 404s (local file), try the other host. */
export function uploadPreviewFallbackSrc(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/uploads/")) {
    return `${PRODUCTION_APP_ORIGIN}${trimmed}`;
  }
  try {
    const url = new URL(trimmed);
    if (
      PRODUCTION_UPLOAD_HOSTS.has(url.hostname.toLowerCase()) &&
      url.pathname.startsWith("/uploads/")
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return null;
  }
  return null;
}

/** Bust CDN/browser caches after a fresh upload (e.g. prior 404s cached as immutable). */
export function withImagePreviewCacheBust(
  url: string,
  nonce?: number | string | null,
): string {
  if (!url || nonce === undefined || nonce === null || nonce === "") return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(String(nonce))}`;
}
