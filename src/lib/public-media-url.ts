import { appAbsoluteUrl, getAppProductSiteUrl } from "@/lib/site-url";
const PRODUCTION_APP_ORIGIN = "https://app.agentranking.io";
function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  );
}
function resolveAppOrigin(): string {
  const origin = getAppProductSiteUrl();
  try {
    const parsed = new URL(origin);
    if (isLocalHostname(parsed.hostname)) return PRODUCTION_APP_ORIGIN;
  } catch {
    return PRODUCTION_APP_ORIGIN;
  }
  return origin;
}
/** Uploaded file path or absolute http(s) URL — used for avatars and token images. */
export function normalizeUserMediaUrl(value: string | undefined, field = "Image"): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  throw new Error(`${field} must be an uploaded file or a URL starting with http:// or https://`);
}
/** Optional website — accepts uploads, full URLs, or bare domains (auto https). */
export function normalizeOptionalWebsiteUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^([\w-]+\.)+[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}
/** Convert stored upload path to a fetchable public URL (required for Pump/IPFS metadata). */
export function resolveUploadPublicUrl(storedUrl: string | null | undefined): string {
  const trimmed = storedUrl?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      if (isLocalHostname(parsed.hostname)) {
        return `${resolveAppOrigin()}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("/uploads/")) {
      return `${resolveAppOrigin()}${trimmed}`;
    }
    return appAbsoluteUrl(trimmed);
  }
  return trimmed;
}
