/** Canonical app-host login path (app.agentranking…/auth/login). */
export const APP_LOGIN_PATH = "/auth/login";
/** Branded post-auth transition (sign-in / sign-out confirmation). */
export const AUTH_SESSION_PATH = "/auth/session";
/** MFA challenge after primary auth when TOTP and/or email OTP MFA is enabled. */
export const AUTH_MFA_PATH = "/auth/mfa";
/** Default post-login destination — dashboard overview auto-selects the newest agent. */
export const DEFAULT_APP_POST_LOGIN_PATH = "/dashboard";
export type AuthSessionMode = "sign-in" | "sign-out";
function isAuthSessionMode(value: string | null | undefined): value is AuthSessionMode {
  return value === "sign-in" || value === "sign-out";
}
export function parseAuthSessionMode(
  value: string | readonly string[] | null | undefined,
): AuthSessionMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return isAuthSessionMode(raw) ? raw : "sign-in";
}
export function isAppAuthRoutePath(pathname: string | null | undefined): boolean {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/";
  return path === APP_LOGIN_PATH || path.startsWith("/auth/") || path.startsWith("/dashboard/auth/");
}
export function appMfaUrl(callbackUrl?: string): string {
  if (!callbackUrl?.trim()) return AUTH_MFA_PATH;
  return `${AUTH_MFA_PATH}?callbackUrl=${encodeURIComponent(normalizeAppCallbackPath(callbackUrl))}`;
}
function isAllowedAppCallbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "app.agentranking.io" ||
    host === "beta.agentranking.io" ||
    host === "agentranking.io" ||
    host === "app.agentranking.localhost" ||
    host.endsWith(".localhost")
  );
}
function normalizeCallbackCandidate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  try {
    const url = new URL(value);
    if (!isAllowedAppCallbackHost(url.hostname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
/**
 * Resolve app login callback input to a safe same-app path.
 * Rejects external URLs, protocol-relative URLs, auth self-loops, and API routes.
 */
export function normalizeAppCallbackPath(
  callbackUrl: string | readonly string[] | null | undefined,
): string {
  const raw = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;
  const candidate = raw ? normalizeCallbackCandidate(raw) : null;
  if (!candidate) return DEFAULT_APP_POST_LOGIN_PATH;
  try {
    const url = new URL(candidate, "https://app.agentranking.io");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (!url.pathname.startsWith("/") || candidate.startsWith("//")) {
      return DEFAULT_APP_POST_LOGIN_PATH;
    }
    if (isAppAuthRoutePath(path) || path.startsWith("/api/")) {
      return DEFAULT_APP_POST_LOGIN_PATH;
    }
    if (path === "/" || path === "/dashboard") {
      return DEFAULT_APP_POST_LOGIN_PATH;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_APP_POST_LOGIN_PATH;
  }
}
export function resolveAuthenticatedAppLoginRedirectPath(
  callbackUrl: string | readonly string[] | null | undefined,
): string {
  return normalizeAppCallbackPath(callbackUrl);
}
export function appLoginUrl(callbackUrl?: string): string {
  if (!callbackUrl?.trim()) return APP_LOGIN_PATH;
  return `${APP_LOGIN_PATH}?callbackUrl=${encodeURIComponent(normalizeAppCallbackPath(callbackUrl))}`;
}
function normalizeSignOutDestination(
  next: string | readonly string[] | null | undefined,
): string {
  const raw = Array.isArray(next) ? next[0] : next;
  const candidate = raw ? normalizeCallbackCandidate(raw) : null;
  if (!candidate) return APP_LOGIN_PATH;
  try {
    const url = new URL(candidate, "https://app.agentranking.io");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === APP_LOGIN_PATH) return `${APP_LOGIN_PATH}${url.search}${url.hash}`;
    if (
      candidate.startsWith("//") ||
      path === AUTH_SESSION_PATH ||
      path.startsWith(`${AUTH_SESSION_PATH}/`) ||
      path.startsWith("/api/") ||
      path.startsWith("/dashboard")
    ) {
      return APP_LOGIN_PATH;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return APP_LOGIN_PATH;
  }
}
export function buildAuthSessionUrl({
  mode,
  next,
}: {
  readonly mode: AuthSessionMode;
  readonly next?: string | readonly string[] | null;
}): string {
  const destination = mode === "sign-out"
    ? normalizeSignOutDestination(next)
    : normalizeAppCallbackPath(next);
  const params = new URLSearchParams({ mode, next: destination });
  return `${AUTH_SESSION_PATH}?${params.toString()}`;
}
/** OAuth / wallet sign-in callback — brief confirmation before landing. */
export function buildSignInCallbackUrl(
  next?: string | readonly string[] | null,
): string {
  return buildAuthSessionUrl({ mode: "sign-in", next });
}
/** Post sign-out transition. Defaults to login and never redirects into dashboard. */
export function buildSignOutCallbackUrl(
  next?: string | readonly string[] | null,
): string {
  return buildAuthSessionUrl({ mode: "sign-out", next });
}
