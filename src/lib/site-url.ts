import { isPublicSiteHost } from "@/lib/product-host";
import { devUsesHttps } from "@/lib/nextauth-url";
import { isDemoMode } from "@/lib/demo-mode";
/** Protocol used by the running local dev command. */
export function localDevProtocol(): "http:" | "https:" {
  return devUsesHttps() ? "https:" : "http:";
}
/** Absolute URL on the app product host (for links from the dashboard or public site). */
export function appAbsoluteUrl(path: string): string {
  if (!path) return getAppProductSiteUrl();
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getAppProductSiteUrl()}${normalizedPath}`;
}
/** Canonical production origins. Local execution is normalized to localhost. */
const DEFAULT_APP_SITE_URL = "https://app.agentranking.io";
const DEFAULT_PUBLIC_SITE_URL = "https://agentranking.io";
const DEFAULT_STAKE_SITE_URL = "https://stake.agentranking.io";
const DEFAULT_ANALYTICS_SITE_URL = "https://analytics.agentranking.io";
function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}
function isPublicMarketingHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "agentranking.io" || host === "www.agentranking.io";
}
function isDedicatedStakeHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "stake.agentranking.io" || host.endsWith(".stake.agentranking.io");
}
function ensureProtocol(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const hostname = url.split(/[/:]/, 1)[0] ?? "";
  return `${isLocalHostname(hostname) ? "http" : "https"}://${url}`;
}
function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
/** Dev Next.js port (default 3000). Omit suffix only for 80/443. */
export function localDevPortSuffix(port: string): string {
  const p = (port || process.env.PORT || "3000").trim();
  if (p === "80" || p === "443") return "";
  return `:${p}`;
}
function localOrigin(port = process.env.PORT || "3000"): string {
  return `${localDevProtocol()}//localhost${localDevPortSuffix(port)}`;
}
function normalizeConfiguredBase(raw: string, localPath = ""): string {
  const normalized = stripTrailingSlash(ensureProtocol(raw.trim()));
  try {
    const parsed = new URL(normalized);
    if (!isLocalHostname(parsed.hostname)) return normalized;
    const port = parsed.port || process.env.PORT || "3000";
    return `${localOrigin(port)}${localPath}`;
  } catch {
    return normalized;
  }
}
function configuredLocalPort(): string | null {
  // Never treat baked-in localhost NEXT_PUBLIC_* values as authoritative in production.
  if (process.env.NODE_ENV === "production") return null;
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_ROOT_SITE_URL,
    process.env.NEXT_PUBLIC_STAKE_SITE_URL,
    process.env.NEXT_PUBLIC_ANALYTICS_SITE_URL,
  ];
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      const parsed = new URL(ensureProtocol(candidate.trim()));
      if (isLocalHostname(parsed.hostname)) {
        return parsed.port || process.env.PORT || "3000";
      }
    } catch {
      // Ignore malformed optional configuration and inspect the next candidate.
    }
  }
  return null;
}
function resolveProductionConfiguredUrl(
  fromEnv: string | undefined,
  defaultUrl: string,
): string {
  const trimmed = fromEnv?.trim();
  if (!trimmed) return defaultUrl;
  try {
    const parsed = new URL(ensureProtocol(trimmed));
    if (isLocalHostname(parsed.hostname)) return defaultUrl;
  } catch {
    return defaultUrl;
  }
  return normalizeConfiguredBase(trimmed);
}
function getConfiguredAppSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_APP_SITE_URL;
  if (process.env.NODE_ENV === "production") {
    return resolveProductionConfiguredUrl(fromEnv, DEFAULT_APP_SITE_URL);
  }
  return normalizeConfiguredBase(fromEnv);
}
/**
 * Origin for admin magic-link emails — always the app host, not the public site.
 */
export function getAdminLoginBaseUrl(): string {
  const explicit = process.env.ADMIN_LOGIN_BASE_URL?.trim();
  if (explicit) return normalizeConfiguredBase(explicit);
  return getAppProductSiteUrl();
}
/** Public-site origin. Local development uses the same localhost origin as the app. */
export function getPublicSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_ROOT_SITE_URL?.trim();
  if (fromEnv) {
    if (process.env.NODE_ENV === "production") {
      return resolveProductionConfiguredUrl(fromEnv, DEFAULT_PUBLIC_SITE_URL);
    }
    return normalizeConfiguredBase(fromEnv);
  }
  const configuredPort = configuredLocalPort();
  if (configuredPort) return localOrigin(configuredPort);
  if (process.env.NODE_ENV === "development") return localOrigin();
  return DEFAULT_PUBLIC_SITE_URL;
}
function normalizeStakeSiteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return stripTrailingSlash(parsed.toString());
  } catch {
    return stripTrailingSlash(url);
  }
}
/** Public staking product URL. Local execution uses `/stake` on localhost. */
export function getStakeSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_STAKE_SITE_URL?.trim();
  if (fromEnv) {
    const normalized =
      process.env.NODE_ENV === "production"
        ? resolveProductionConfiguredUrl(fromEnv, DEFAULT_STAKE_SITE_URL)
        : normalizeConfiguredBase(fromEnv, "/stake");
    try {
      const parsed = new URL(normalized);
      if (isLocalHostname(parsed.hostname)) return normalized;
      // Legacy env pointed the stake product at the marketing origin. Keep
      // the dedicated staking host so CTAs never land on agentranking.io/.
      if (isPublicMarketingHost(parsed.hostname)) return DEFAULT_STAKE_SITE_URL;
    } catch {
      // Fall through to production normalization.
    }
    return normalizeStakeSiteUrl(normalized);
  }
  const configuredPort = configuredLocalPort();
  if (configuredPort) return `${localOrigin(configuredPort)}/stake`;
  if (process.env.NODE_ENV === "development") return `${localOrigin()}/stake`;
  return DEFAULT_STAKE_SITE_URL;
}
/** Browser-facing stake UI path (stake.agentranking.io/stake, or /stake on localhost). */
export function getStakePageUrl(): string {
  const site = stripTrailingSlash(getStakeSiteUrl());
  if (site.endsWith("/stake")) return site;
  try {
    const parsed = new URL(site);
    const host = parsed.hostname.toLowerCase();
    if (isDedicatedStakeHost(host)) return `${site}/stake`;
    if (isPublicMarketingHost(host)) return `${DEFAULT_STAKE_SITE_URL}/stake`;
    if (parsed.pathname === "" || parsed.pathname === "/") return `${site}/stake`;
  } catch {
    return `${site}/stake`;
  }
  return site;
}
/** Public analytics product URL. Local execution uses `/analytics` on localhost. */
export function getAnalyticsSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_ANALYTICS_SITE_URL?.trim();
  if (fromEnv) {
    if (process.env.NODE_ENV === "production") {
      return resolveProductionConfiguredUrl(fromEnv, DEFAULT_ANALYTICS_SITE_URL);
    }
    return normalizeConfiguredBase(fromEnv, "/analytics");
  }
  const configuredPort = configuredLocalPort();
  if (configuredPort) return `${localOrigin(configuredPort)}/analytics`;
  if (process.env.NODE_ENV === "development") return `${localOrigin()}/analytics`;
  return DEFAULT_ANALYTICS_SITE_URL;
}
export function getMetadataBase(): URL {
  return new URL(getAppProductSiteUrl());
}
export function absoluteUrl(path: string): string {
  if (!path) return getAppProductSiteUrl();
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getAppProductSiteUrl()}${normalizedPath}`;
}
/** Canonical docs origin. */
export function docsAbsoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = getPublicSiteUrl();
  if (!path || path === "/docs") return `${base}/docs`;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
/** App product origin. Local execution always uses the single localhost origin. */
export function getAppProductSiteUrl(): string {
  const configuredPort = configuredLocalPort();
  if (configuredPort) return localOrigin(configuredPort);
  if (process.env.NODE_ENV === "development") {
    try {
      const configured = new URL(getConfiguredAppSiteUrl());
      return localOrigin(configured.port || process.env.PORT || "3000");
    } catch {
      return localOrigin();
    }
  }
  const site = getConfiguredAppSiteUrl();
  try {
    const url = new URL(site);
    const host = url.hostname.toLowerCase();
    if (isLocalHostname(host)) return DEFAULT_APP_SITE_URL;
    if (isPublicSiteHost(host)) return DEFAULT_APP_SITE_URL;
    if (host === "app.agentranking.io" || host === "beta.agentranking.io") {
      return stripTrailingSlash(site);
    }
    // Demo deployments serve the site and the app from their own single host.
    if (isDemoMode()) return stripTrailingSlash(site);
    return DEFAULT_APP_SITE_URL;
  } catch {
    return DEFAULT_APP_SITE_URL;
  }
}
export function getAppHomeUrl(): string {
  return `${getAppProductSiteUrl()}/`;
}
/** Local app URL used for links and OAuth callbacks. */
export function buildLocalDevAppHomeUrl(protocol: string, port: string): string {
  return `${protocol}//localhost${localDevPortSuffix(port)}/`;
}
/** Public Agent Dashboard origin. */
export function getDashboardSiteUrl(): string {
  return getAppProductSiteUrl();
}
/** Creator dashboard home on the app host. */
export function getDashboardHomeUrl(): string {
  return `${getAppProductSiteUrl()}/dashboard`;
}
export function dashboardAbsoluteUrl(path: string): string {
  if (!path) return getDashboardHomeUrl();
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getDashboardSiteUrl()}${normalizedPath}`;
}
function hostWithoutPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "::1") return trimmed;
  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    return trimmed.slice(1, trimmed.indexOf("]"));
  }
  const portStart = trimmed.lastIndexOf(":");
  if (portStart <= 0) return trimmed;
  return /^\d+$/.test(trimmed.slice(portStart + 1)) ? trimmed.slice(0, portStart) : trimmed;
}
/** Resolve the app home href from the request host (SSR + client). */
export function resolveAppHomeHrefFromHost(hostHeader: string): string {
  const host = hostWithoutPort(hostHeader);
  if (host === "app.agentranking.io" || host === "beta.agentranking.io" || isLocalHostname(host)) {
    return "/";
  }
  return getAppHomeUrl();
}
function isAppProductHostname(hostname: string): boolean {
  const host = hostWithoutPort(hostname);
  return host === "app.agentranking.io" || host === "beta.agentranking.io" || isLocalHostname(host);
}
/** Whether a nav href should highlight Home for the current `/` route. */
export function isAppHomeNavHref(href: string, pathname: string): boolean {
  const path = pathname === "" ? "/" : pathname;
  if (path !== "/") return false;
  if (href === "/" || href === "") return true;
  try {
    const url = new URL(href);
    if (!isAppProductHostname(url.hostname)) return false;
    return url.pathname === "/" || url.pathname === "";
  } catch {
    return false;
  }
}
