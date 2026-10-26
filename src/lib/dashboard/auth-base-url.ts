import { getDashboardSiteUrl } from "@/lib/site-url";

const PRODUCTION_APP_ORIGIN = "https://app.agentranking.io";

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function ensureProtocol(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://${url}`;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

function originFromEnvValue(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(ensureProtocol(trimmed));
    if (isLocalHostname(parsed.hostname)) return null;
    return stripTrailingSlash(parsed.origin);
  } catch {
    return null;
  }
}

function resolveConfiguredPublicOrigin(): string | null {
  return (
    originFromEnvValue(process.env.DASHBOARD_AUTH_BASE_URL) ??
    originFromEnvValue(process.env.NEXTAUTH_URL) ??
    originFromEnvValue(process.env.NEXT_PUBLIC_SITE_URL) ??
    null
  );
}

/**
 * In development, auth tokens are written to the local database. Email links must
 * target the same origin (localhost) unless you explicitly opt into production URLs
 * and use a production DATABASE_URL (e.g. SSH tunnel).
 */
function shouldUseProductionAuthLinksInDev(): boolean {
  return process.env.DASHBOARD_AUTH_FORCE_PRODUCTION_LINKS === "1";
}

/** Origin for dashboard authentication emails and magic links. */
export function getDashboardAuthBaseUrl(): string {
  if (process.env.NODE_ENV === "development" && !shouldUseProductionAuthLinksInDev()) {
    return getDashboardSiteUrl();
  }

  const configured = resolveConfiguredPublicOrigin();
  if (configured) return configured;

  return PRODUCTION_APP_ORIGIN;
}

/** Dashboard home URL for transactional email footers (resolved at send time). */
export function getDashboardEmailHomeUrl(): string {
  return `${getDashboardAuthBaseUrl()}/dashboard`;
}
