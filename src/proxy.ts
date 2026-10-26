import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
/**
 * Next.js 16+ loads this file as the routing middleware entry. Do not add
 * `src/middleware.ts`; Next rejects projects that define both entry points.
 */
import { getToken } from "next-auth/jwt";
import { getSessionFromRequest } from "@/lib/admin-auth-session";
import { getPublicSiteUrl, getAppProductSiteUrl, getStakeSiteUrl } from "@/lib/site-url";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import {
  isProductHostPublicAssetPath,
  isSiteMaintenanceEnabled,
  isSiteMaintenanceExemptPath,
} from "@/lib/site-maintenance";
import { evaluateApiBodyPolicy } from "@/lib/api-body-policy";
import { DEMO_BLOCKED_HEADER, DEMO_BLOCKED_MESSAGE, isDemoMode } from "@/lib/demo-mode";
function declaredApiBodySizeResponse(request: NextRequest): NextResponse | undefined {
  const result = evaluateApiBodyPolicy({
    pathname: request.nextUrl.pathname,
    method: request.method,
    hasBody: request.body !== null,
    contentLength: request.headers.get("content-length"),
  });
  if (result.ok) return undefined;
  return NextResponse.json({ error: result.message }, { status: result.status });
}
/** Rate-limit public JSON APIs at the edge; returns a response to short-circuit or undefined to continue. */
async function publicApiRateLimitResponse(request: NextRequest): Promise<NextResponse | undefined> {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/v1") || pathname === "/api/mcp" || pathname.startsWith("/api/mcp/")) {
    if (request.method === "OPTIONS") return NextResponse.next();
    return (await rateLimitPublicApi(request, "standard")) ?? undefined;
  }
  if (pathname.startsWith("/api/v2")) {
    if (request.method === "OPTIONS") return NextResponse.next();
    if (request.method === "GET") {
      return (await rateLimitPublicApi(request, "extended")) ?? undefined;
    }
  }
  if (pathname === "/api/agents") {
    if (request.method === "OPTIONS") return NextResponse.next();
    if (request.method === "GET") {
      return (await rateLimitPublicApi(request, "agents")) ?? undefined;
    }
  }
  return undefined;
}
const PUBLIC_SITE_HOSTS = new Set(["agentranking.io", "www.agentranking.io"]);
const STAKE_HOSTS = new Set(["stake.agentranking.io"]);
/** Public-site routes served on the public-site host. */
const PUBLIC_SITE_PAGE_PATHS = new Set([
  "/locked-supply",
  "/ai-agent-rankings",
  "/crypto-ai-agents",
  "/on-chain-ai-agents",
  "/solana-ai-agents",
  "/erc-8004-agents",
  "/x402-ai-agents",
  "/mcp-agent-marketplace",
  "/mcp",
  "/world",
]);
/** Docs live on the public-site host only (agentranking.io/docs), not the app host. */
function isDocsPath(pathname: string): boolean {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}
const PUBLIC_SITE_PAGE_PREFIXES = [
  "/tokens",
  "/agents",
  "/ranking",
  "/launch",
  "/news",
] as const;
function isPublicSitePagePath(pathname: string): boolean {
  if (PUBLIC_SITE_PAGE_PATHS.has(pathname)) return true;
  return PUBLIC_SITE_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
/** Crawler/discovery files should be served on the public site too, not 301'd to the app host. */
const PUBLIC_SITE_CRAWLER_PATHS = new Set(["/robots.txt", "/sitemap.xml", "/feed.xml"]);
function isPublicSiteCrawlerPath(pathname: string): boolean {
  if (PUBLIC_SITE_CRAWLER_PATHS.has(pathname)) return true;
  if (!pathname.startsWith("/sitemap/") || !pathname.endsWith(".xml")) return false;
  const id = pathname.slice("/sitemap/".length, -".xml".length);
  return id.length > 0 && id.split("").every((ch) => ch >= "0" && ch <= "9");
}
function hostWithoutPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  const portStart = trimmed.lastIndexOf(":");
  if (portStart <= 0) return trimmed;
  return /^\d+$/.test(trimmed.slice(portStart + 1)) ? trimmed.slice(0, portStart) : trimmed;
}
function isAppProductHost(host: string): boolean {
  const h = hostWithoutPort(host);
  return h === "app.agentranking.io" || h === "beta.agentranking.io";
}
function isLocalRuntimeHost(host: string): boolean {
  const h = hostWithoutPort(host);
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}
/** Dev-only: OAuth clients are registered on plain localhost — unify auth on localhost. */
function devAppLocalhostAuthRedirect(request: NextRequest): NextResponse | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  const host = hostWithoutPort(request.headers.get("host") ?? "");
  if (host !== "app.agentranking.localhost") return undefined;
  const { pathname } = request.nextUrl;
  if (
    !pathname.startsWith("/dashboard") &&
    !pathname.startsWith("/auth/") &&
    pathname !== "/auth/login"
  ) {
    return undefined;
  }
  if (pathname.startsWith("/api/")) return undefined;
  const port = request.nextUrl.port || process.env.PORT || "3000";
  const target = request.nextUrl.clone();
  target.hostname = "localhost";
  target.port = port;
  return NextResponse.redirect(target, 307);
}
function publicSiteUrlForRequest(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  if (process.env.NODE_ENV === "development") {
    const publicSiteBase = new URL(getPublicSiteUrl());
    url.hostname = publicSiteBase.hostname;
    url.protocol = publicSiteBase.protocol;
    url.port = publicSiteBase.port;
    return url;
  }
  const publicSiteBase = new URL(getPublicSiteUrl());
  url.hostname = publicSiteBase.hostname;
  url.protocol = publicSiteBase.protocol;
  url.port = publicSiteBase.port;
  return url;
}
/** Route the product-app root to its dashboard workspace. */
function appHostRootToDashboardRedirect(request: NextRequest): NextResponse | undefined {
  if (process.env.NODE_ENV !== "production") return undefined;
  const host = hostWithoutPort(request.headers.get("host") ?? "");
  if (!isAppProductHost(host)) return undefined;
  const { pathname } = request.nextUrl;
  if (pathname !== "/" && pathname !== "") return undefined;
  const url = request.nextUrl.clone();
  url.pathname = "/dashboard";
  return NextResponse.redirect(url, 307);
}
/** Route public-site paths from the product app host to the public-site host. */
function appHostPublicSiteRedirect(request: NextRequest): NextResponse | undefined {
  if (process.env.NODE_ENV !== "production") return undefined;
  const host = hostWithoutPort(request.headers.get("host") ?? "");
  if (!isAppProductHost(host) || !isPublicSitePagePath(request.nextUrl.pathname)) {
    return undefined;
  }
  const target = publicSiteUrlForRequest(request);
  const status = process.env.NODE_ENV === "production" ? 301 : 307;
  return NextResponse.redirect(target, status);
}
/** Canonical docs on the public site — redirect the production app host off `/docs`. */
function docsCanonicalHostRouting(request: NextRequest): NextResponse | undefined {
  if (process.env.NODE_ENV !== "production") return undefined;
  const { pathname } = request.nextUrl;
  if (!isDocsPath(pathname)) return undefined;
  const host = hostWithoutPort(request.headers.get("host") ?? "");
  if (PUBLIC_SITE_HOSTS.has(host)) return undefined;
  if (!isAppProductHost(host)) return undefined;
  const target = publicSiteUrlForRequest(request);
  target.pathname = pathname;
  target.search = request.nextUrl.search;
  target.hash = request.nextUrl.hash;
  return NextResponse.redirect(target, 301);
}
function appUrlForPublicSitePath(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  if (process.env.NODE_ENV === "development") return url;
  const appBase = new URL(getAppProductSiteUrl());
  url.hostname = appBase.hostname;
  url.protocol = appBase.protocol;
  url.port = appBase.port;
  return url;
}
function stakeHostRouting(request: NextRequest): NextResponse | undefined {
  // Demo deployments have one host, so /stake is served in place like local development.
  if (process.env.NODE_ENV !== "production" || isDemoMode()) return undefined;
  const pathname = request.nextUrl.pathname;
  const host = hostWithoutPort(request.headers.get("host") ?? "");
  if (isLocalRuntimeHost(host)) return undefined;
  if (STAKE_HOSTS.has(host)) {
    if (pathname === "/" || pathname === "") {
      const internalUrl = request.nextUrl.clone();
      internalUrl.pathname = "/stake";
      return NextResponse.rewrite(internalUrl);
    }
    if (pathname === "/stake" || pathname === "/stake/") {
      const canonicalUrl = request.nextUrl.clone();
      canonicalUrl.pathname = "/";
      canonicalUrl.search = "";
      canonicalUrl.hash = "";
      return NextResponse.redirect(canonicalUrl, 308);
    }
    return undefined;
  }
  if (pathname === "/stake" || pathname === "/stake/") {
    return NextResponse.redirect(new URL(getStakeSiteUrl()), 308);
  }
  return undefined;
}
function publicSiteHostRouting(request: NextRequest): NextResponse | undefined {
  if (process.env.NODE_ENV !== "production") return undefined;
  const pathname = request.nextUrl.pathname;
  const host = hostWithoutPort(request.headers.get("host") ?? "");
  const isProductionPublicSite = PUBLIC_SITE_HOSTS.has(host);
  if (!isProductionPublicSite) return undefined;
  if (pathname === "/" || pathname === "") return undefined;
  if (isPublicSiteCrawlerPath(pathname)) return undefined;
  if (isPublicSitePagePath(pathname)) return undefined;
  if (isDocsPath(pathname)) return undefined;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    isProductHostPublicAssetPath(pathname)
  ) {
    return undefined;
  }
  return NextResponse.redirect(appUrlForPublicSitePath(request), 301);
}
/** Sitewide maintenance (agentranking.io and app hosts). Set SITE_MAINTENANCE=1 on VPS or in .env.local. */
function siteMaintenanceRouting(request: NextRequest): NextResponse | undefined {
  if (!isSiteMaintenanceEnabled()) return undefined;
  const { pathname } = request.nextUrl;
  if (isSiteMaintenanceExemptPath(pathname)) return undefined;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "AgentRanking is temporarily under maintenance. Please try again shortly." },
      { status: 503 },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = "/maintenance.html";
  return NextResponse.rewrite(url);
}
/** Machine and operator surfaces that a demo deployment never serves, for any method. */
const DEMO_CLOSED_API_PREFIXES = [
  "/api/admin",
  "/api/dashboard/admin",
  "/api/cron",
  "/api/internal",
  "/api/webhooks",
  "/api/telegram",
] as const;
function isDemoClosedApiPath(pathname: string): boolean {
  return DEMO_CLOSED_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
function demoBlockedResponse(): NextResponse {
  return NextResponse.json(
    { error: DEMO_BLOCKED_MESSAGE, code: "demo_mode" },
    { status: 403, headers: { [DEMO_BLOCKED_HEADER]: "blocked", "Cache-Control": "no-store" } },
  );
}
/**
 * Demo deployments are read-only. Reads pass through to the snapshot database;
 * writes, Server Actions, admin, cron and webhook surfaces are refused here so
 * no route handler can reach payments, chains or paid providers. NextAuth stays
 * open because demo mode registers only the demo sign-in provider.
 */
function demoModeRouting(request: NextRequest, isApiPath: boolean): NextResponse | undefined {
  if (!isDemoMode()) return undefined;
  const { pathname } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return NextResponse.redirect(new URL("/", request.url), 307);
  }
  if (isApiPath && isDemoClosedApiPath(pathname)) return demoBlockedResponse();
  if (request.headers.has("next-action")) return demoBlockedResponse();
  const isRead = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
  if (isApiPath && !isRead && !pathname.startsWith("/api/auth/")) return demoBlockedResponse();
  return undefined;
}
/** Route product hosts to their canonical surfaces before authentication checks. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiPath = pathname === "/api" || pathname.startsWith("/api/");
  const maintenanceRoute = siteMaintenanceRouting(request);
  if (maintenanceRoute) return maintenanceRoute;
  const demoRoute = demoModeRouting(request, isApiPath);
  if (demoRoute) return demoRoute;
  const devAppHostRedirect = devAppLocalhostAuthRedirect(request);
  if (devAppHostRedirect) return devAppHostRedirect;
  if (isApiPath) {
    const declaredBodyTooLarge = declaredApiBodySizeResponse(request);
    if (declaredBodyTooLarge) return declaredBodyTooLarge;
  }
  const stakeRoute = stakeHostRouting(request);
  if (stakeRoute) return stakeRoute;
  const appPublicSiteRedirect = appHostPublicSiteRedirect(request);
  if (appPublicSiteRedirect) return appPublicSiteRedirect;
  const appRootToDashboard = appHostRootToDashboardRedirect(request);
  if (appRootToDashboard) return appRootToDashboard;
  const docsRoute = docsCanonicalHostRouting(request);
  if (docsRoute) return docsRoute;
  const publicSiteRoute = publicSiteHostRouting(request);
  if (publicSiteRoute) return publicSiteRoute;

  // Ordinary public pages need no API policy or authentication work after host
  // routing. Dashboard and admin requests continue below for authentication.
  if (
    !isApiPath
    && !pathname.startsWith("/admin")
    && !pathname.startsWith("/dashboard")
  ) {
    return NextResponse.next();
  }

  if (isApiPath) {
    try {
      const rateLimited = await publicApiRateLimitResponse(request);
      if (rateLimited) return rateLimited;
    } catch (error) {
      console.error("[proxy] public API rate limit unavailable:", error);
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "5",
          },
        },
      );
    }
  }
  const dashboardAdminApi =
    pathname === "/api/dashboard/admin"
    || pathname.startsWith("/api/dashboard/admin/");
  // Protect non-admin /api/dashboard routes with NextAuth JWT session.
  if (pathname.startsWith("/api/dashboard") && !dashboardAdminApi) {
    // Claim + email auth bootstrap remain public. MFA challenge APIs need a pending session.
    const publicDashboardPath =
      pathname === "/api/dashboard/claim" ||
      (pathname.startsWith("/api/dashboard/auth/") &&
        !pathname.startsWith("/api/dashboard/auth/mfa"));
    if (!publicDashboardPath) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (token.mfaVerified === false && !pathname.startsWith("/api/dashboard/auth/mfa")) {
        return NextResponse.json(
          { error: "MFA required", code: "mfa_required" },
          { status: 403 },
        );
      }
    }
    return NextResponse.next();
  }
  // Protect admin pages and both admin API namespaces with the admin session.
  if (
    !pathname.startsWith("/admin")
    && !pathname.startsWith("/api/admin")
    && !dashboardAdminApi
  ) {
    return NextResponse.next();
  }
  // Allow login page and login/logout APIs without auth
  const adminAuthPublic =
    pathname === "/admin/login" ||
    pathname === "/api/admin/auth/logout" ||
    pathname === "/api/admin/auth/request-code" ||
    pathname === "/api/admin/auth/verify-code" ||
    pathname === "/api/admin/auth/complete";
  if (adminAuthPublic) {
    return NextResponse.next();
  }
  const session = await getSessionFromRequest(request);
  if (!session) {
    if (pathname.startsWith("/api/admin") || dashboardAdminApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}
export const config = {
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2|glb|gltf|bin)$).*)",
  ],
};
