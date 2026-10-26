/** Paths that stay reachable while SITE_MAINTENANCE=1 (ops, static assets, maintenance page). */
export function isSiteMaintenanceExemptPath(pathname: string): boolean {
  return (
    pathname === "/maintenance.html" ||
    pathname === "/api/ping" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/.well-known/") ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|webmanifest)$/i.test(pathname)
  );
}
export function isSiteMaintenanceEnabled(): boolean {
  return process.env.SITE_MAINTENANCE === "1";
}
/** Public same-origin assets that must never be redirected between product hosts. */
export function isProductHostPublicAssetPath(pathname: string): boolean {
  return (
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/apple-icon.png" ||
    pathname === "/icon.png" ||
    pathname === "/icon-192.png" ||
    pathname.startsWith("/.well-known/")
  );
}
