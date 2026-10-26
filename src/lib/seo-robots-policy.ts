/**
 * Path prefixes disallowed for all crawlers in `src/app/robots.ts`.
 * URLs under these paths must not appear in `sitemap.xml` or Google will flag
 * "Submitted URL blocked by robots.txt" and sitemap discovery stays at 0.
 */
export const ROBOTS_DISALLOWED_PATH_PREFIXES: readonly string[] = [
  "/api",
  "/admin",
  "/powerboost",
  "/dashboard",
  "/custom-list",
  "/profiles",
];
/** True when a pathname is blocked by the canonical robots policy. */
export function pathnameBlockedByRobotsPolicy(pathname: string): boolean {
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return ROBOTS_DISALLOWED_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
/** Drop sitemap entries whose URL path is blocked by robots.txt. */
export function filterSitemapUrlsByRobotsPolicy<T extends { url: string }>(entries: T[]): T[] {
  return entries.filter((e) => {
    try {
      const path = new URL(e.url).pathname;
      return !pathnameBlockedByRobotsPolicy(path);
    } catch {
      return false;
    }
  });
}
