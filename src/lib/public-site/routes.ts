import { appLoginUrl } from "@/lib/app-auth-routes";
import type { PublicNavItem } from "@/lib/site-config";
import { dashboardAbsoluteUrl, getDashboardHomeUrl, getPublicSiteUrl, getStakePageUrl } from "@/lib/site-url";
/**
 * Canonical browser-facing routes for the public-site and creator entry points.
 *
 * Routes served by this Next.js application stay root-relative so local development,
 * preview deployments, and production hosts preserve the active request origin. The
 * production proxy moves app-only paths from the public host to the canonical app host.
 */
export const publicSiteRoutes = {
  tokens: "/tokens",
  agents: "/agents",
  world: "/world",
  ranking: "/ranking",
  docs: "/docs",
  mcp: "/mcp",
  stake: getStakePageUrl(),
  stakeDocs: "/docs/ar-token",
  /** Public-site login handoff — prefer launchAgentApp for direct app links from marketing pages. */
  launchAgent: appLoginUrl("/dashboard/agents/new"),
  launchApp: getDashboardHomeUrl(),
  launchAgentApp: dashboardAbsoluteUrl("/dashboard/agents/new"),
  createAgent: "/dashboard/agents/new",
  launchToken: "/launch",
} as const;

/** Canonical public-site path on agentranking.io (for footer / marketing links). */
export function publicSiteAbsoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${getPublicSiteUrl()}${normalized}`;
}
/** Tokens | Agents | MCP | Docs | Stake — Launch Agent is a separate header CTA. */
export function buildPublicSiteNavLinks(): PublicNavItem[] {
  return [
    { label: "Tokens", href: publicSiteRoutes.tokens },
    { label: "Agents", href: publicSiteRoutes.agents },
    { label: "World", href: publicSiteRoutes.world },
    { label: "MCP", href: publicSiteRoutes.mcp },
    { label: "Docs", href: publicSiteRoutes.docs },
    { label: "Stake", href: "/#stake" },
  ];
}
export function publicTokenDetailHref(mint: string): string {
  return `${publicSiteRoutes.tokens}/${mint}`;
}
