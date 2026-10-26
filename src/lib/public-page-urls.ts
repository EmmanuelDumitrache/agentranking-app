import {
  STAKE_NAV_PATHS,
  type PublicFooterColumn,
  type PublicNavItem,
  type PublicNavLink,
} from "@/lib/site-config";
import { resolveArDexScreenerUrl, resolveArSolscanTokenUrl } from "@/lib/ar-token-public";
import {
  getPublicSiteUrl,
  getAppProductSiteUrl,
  getDashboardHomeUrl,
  getStakeSiteUrl,
} from "@/lib/site-url";
import { buildPublicSiteNavLinks } from "@/lib/public-site/routes";
const APP = getAppProductSiteUrl();
const PUBLIC_SITE = getPublicSiteUrl();
const STAKE = getStakeSiteUrl();
const DASHBOARD = getDashboardHomeUrl();
const DOCS = `${PUBLIC_SITE}/docs`;
const NEWS = `${PUBLIC_SITE}/news`;
export function buildPublicNavLinks(): PublicNavItem[] {
  return buildPublicSiteNavLinks();
}
export function buildStakeNavLinks(): PublicNavLink[] {
  return STAKE_NAV_PATHS.map((item) => {
    const origin = item.site === "stake" ? STAKE : PUBLIC_SITE;
    const path = item.path === "/" ? "" : item.path;
    return {
      label: item.label,
      href: `${origin}${path}`,
      external: item.site === "publicSite",
    };
  });
}
type PublicFooterOptions = {
  /** Keep routes served by this Next.js application on the request origin. */
  readonly sameOrigin?: boolean;
};
export function buildPublicFooterColumns(
  options: PublicFooterOptions = {},
): PublicFooterColumn[] {
  const appHref = (path: string) => (options.sameOrigin ? path : `${APP}${path}`);
  const publicSiteHref = (path: string) => (options.sameOrigin ? path : `${PUBLIC_SITE}${path}`);
  return [
    {
      title: "Product",
      links: [
        { label: "Tokens", href: publicSiteHref("/tokens") },
        { label: "Agents", href: publicSiteHref("/agents") },
        { label: "MCP", href: publicSiteHref("/mcp") },
        { label: "Creator App", href: appHref("/dashboard") },
      ],
    },
    {
      title: "Platform",
      links: [
        { label: "Launchpad", href: publicSiteHref("/launch") },
        { label: "Verification", href: appHref("/verified") },
        { label: "API / Services", href: publicSiteHref("/docs") },
        { label: "Stake", href: STAKE },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Docs", href: publicSiteHref("/docs") },
        { label: "News", href: publicSiteHref("/news") },
        { label: "GitHub", href: "https://github.com/agentranking", external: true },
      ],
    },
    {
      title: "Community",
      links: [
        { label: "X", href: "https://x.com/agentranking", external: true },
        { label: "Telegram", href: "https://t.me/agentrankingtg", external: true },
        { label: "Solscan", href: resolveArSolscanTokenUrl(), external: true },
        { label: "Dexscreener", href: resolveArDexScreenerUrl(), external: true },
      ],
    },
  ];
}
export const publicPageUrls = {
  publicSite: PUBLIC_SITE,
  app: APP,
  stake: STAKE,
  dashboard: DASHBOARD,
  docs: DOCS,
  news: NEWS,
  verify: `${APP}/dashboard`,
  verified: `${APP}/verified`,
  agents: `${PUBLIC_SITE}/agents`,
  tokens: `${PUBLIC_SITE}/tokens`,
  ranking: `${PUBLIC_SITE}/ranking`,
  mcp: `${PUBLIC_SITE}/mcp`,
} as const;
