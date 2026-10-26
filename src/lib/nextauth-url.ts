/** True only when local HTTPS is explicitly configured. Normal local development uses HTTP. */
export function devUsesHttps(): boolean {
  return process.env.DEV_USE_HTTPS === "1";
}
function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  );
}
function parseConfiguredUrl(configured: string): URL | null {
  try {
    const raw = /^https?:\/\//i.test(configured) ? configured : `http://${configured}`;
    return new URL(raw);
  } catch {
    return null;
  }
}
function canonicalLocalNextAuthUrl(port: string): string {
  const protocol = devUsesHttps() ? "https" : "http";
  return `${protocol}://localhost:${port}`;
}
/**
 * Keep OAuth callbacks on plain localhost so existing Google/X dev redirect URIs
 * keep working. `*.localhost` app hosts redirect to localhost for /auth and /dashboard.
 */
export function ensureDevNextAuthUrl(): string {
  const configured = process.env.NEXTAUTH_URL?.trim() ?? "";
  const explicitPort = process.env.PORT?.trim();
  const parsed = configured ? parseConfiguredUrl(configured) : null;
  if (parsed && isLocalHostname(parsed.hostname)) {
    const port = explicitPort || parsed.port || "3000";
    const localUrl = canonicalLocalNextAuthUrl(port);
    process.env.NEXTAUTH_URL = localUrl;
    return localUrl;
  }
  if (process.env.NODE_ENV !== "development") return configured;
  if (configured) return configured;
  const localUrl = canonicalLocalNextAuthUrl(explicitPort || "3000");
  process.env.NEXTAUTH_URL = localUrl;
  return localUrl;
}
