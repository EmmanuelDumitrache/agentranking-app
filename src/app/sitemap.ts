import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { agentPublicPath } from "@/lib/agent-public-url";
import {
  getPublicSiteUrl,
  getAppProductSiteUrl,
  getStakeSiteUrl,
} from "@/lib/site-url";
import { getAllArticleSlugs } from "@/content/news/articles";
import { ARCHETYPES } from "@/lib/archetype-classifier";
import { agentsArchetypeHref } from "@/lib/agents-archetype-filter";
import { filterSitemapUrlsByRobotsPolicy } from "@/lib/seo-robots-policy";
import { getSapCapabilityStaticSlugs } from "@/lib/sap-ecosystem";
import { PUBLIC_SITE_SEO_PAGES } from "@/lib/public-site-seo-pages";
import { DOCS_PAGE_SPECS } from "@/lib/docs/content/pages";
import { DOCS_PARTNERS } from "@/content/docs-partners";
import {
  buildSitemapRouteIds,
  getActiveAgentsSitemapChunk,
} from "@/lib/sitemap-chunks";
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}
export const revalidate = 86400;
export async function generateSitemaps(): Promise<{ id: number }[]> {
  try {
    return await buildSitemapRouteIds();
  } catch (error) {
    console.error("[sitemap] generateSitemaps failed:", error);
    return [{ id: 0 }];
  }
}
async function resolveSitemapId(
  id: number | Promise<number | string | undefined> | undefined,
): Promise<number> {
  if (id === undefined || id === null) return Number.NaN;
  const value = await Promise.resolve(id);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}
function dedupeSitemapEntries(
  entries: MetadataRoute.Sitemap,
): MetadataRoute.Sitemap {
  const byUrl = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const entry of entries) {
    byUrl.set(entry.url, entry);
  }
  return Array.from(byUrl.values());
}
function buildCanonicalStaticRoutes(): MetadataRoute.Sitemap {
  const app = getAppProductSiteUrl();
  const publicSite = getPublicSiteUrl();
  const stake = getStakeSiteUrl();
  const now = new Date();
  return [
    { url: publicSite, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${publicSite}/tokens`, lastModified: now, changeFrequency: "hourly", priority: 0.95 },
    { url: `${publicSite}/agents`, lastModified: now, changeFrequency: "hourly", priority: 0.95 },
    { url: `${publicSite}/world`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${publicSite}/ranking`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${publicSite}/mcp`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${publicSite}/launch`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${publicSite}/locked-supply`, lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${publicSite}/news`, lastModified: now, changeFrequency: "weekly", priority: 0.86 },
    ...getAllArticleSlugs().map((slug) => ({
      url: `${publicSite}/news/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.76,
    })),
    ...PUBLIC_SITE_SEO_PAGES.map((page) => ({
      url: `${publicSite}/${page.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.84,
    })),
    ...ARCHETYPES.map((archetype) => ({
      url: `${publicSite}${agentsArchetypeHref(archetype.slug)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.78,
    })),
    { url: stake, lastModified: now, changeFrequency: "weekly", priority: 0.92 },
    {
      url: `${app}/metaplex`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.85,
    },
    { url: `${app}/llms.txt`, lastModified: now, changeFrequency: "weekly", priority: 0.4 },
    { url: `${app}/create`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${app}/x402-market`, lastModified: now, changeFrequency: "daily", priority: 0.86 },
    { url: `${app}/jobs`, lastModified: now, changeFrequency: "daily", priority: 0.82 },
    { url: `${app}/powerboost`, lastModified: now, changeFrequency: "daily", priority: 0.84 },
    { url: `${app}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.85 },
    { url: `${app}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${app}/analytics`, lastModified: now, changeFrequency: "daily", priority: 0.75 },
    { url: `${app}/networks`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${app}/verified`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${app}/custom-list`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${app}/new`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${app}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${app}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${publicSite}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...DOCS_PAGE_SPECS.filter((page) => page.slug.length > 0).map((page) => ({
      url: `${publicSite}/docs/${page.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: page.slug === "staking" ? 0.88 : 0.76,
    })),
    ...DOCS_PARTNERS.filter((partner) => !partner.hubExternal).map((partner) => ({
      url: `${publicSite}/docs/partners/${partner.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.74,
    })),
    { url: `${app}/sap`, lastModified: now, changeFrequency: "daily", priority: 0.82 },
    { url: `${app}/sap/leaderboard`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${app}/sap/compare`, lastModified: now, changeFrequency: "weekly", priority: 0.78 },
    { url: `${app}/sap/capabilities`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
  ];
}
export default async function sitemap({
  id,
}: {
  id?: number | Promise<number | string | undefined>;
}): Promise<MetadataRoute.Sitemap> {
  const app = getAppProductSiteUrl();
  const publicSite = getPublicSiteUrl();
  const numId = await resolveSitemapId(id);
  if (!Number.isFinite(numId) || numId < 0) return [];
  if (numId === 0) {
    let routes = filterSitemapUrlsByRobotsPolicy(buildCanonicalStaticRoutes());
    if (!isBuildPhase()) {
      const chains = await withTransientPoolRetry(() =>
        prisma.chain.findMany({
          where: { isActive: true, agentCount: { gt: 0 } },
          select: { chainId: true },
        }),
      );
      routes = [
        ...routes,
        ...chains.map((chain) => ({
          url: `${app}/networks/${chain.chainId}`,
          lastModified: new Date(),
          changeFrequency: "weekly" as const,
          priority: 0.75,
        })),
      ];
      const capabilities = await getSapCapabilityStaticSlugs();
      routes = [
        ...routes,
        ...capabilities.map((row) => ({
          url: `${app}/sap/capabilities/${encodeURIComponent(row.capabilityId)}`,
          lastModified: new Date(),
          changeFrequency: "weekly" as const,
          priority: 0.76,
        })),
      ];
      const launches = await withTransientPoolRetry(() =>
        prisma.agentLaunch.findMany({
          where: {
            mint: { not: null },
            launchStatus: { in: ["token_created", "fee_share_pending", "indexed"] },
          },
          select: { mint: true, network: true, updatedAt: true },
          take: 5_000,
          orderBy: { updatedAt: "desc" },
        }),
      );
      routes = [
        ...routes,
        ...launches.flatMap((row) => {
          if (!row.mint) return [];
          const isRobinhood =
            row.network.toLowerCase().includes("robinhood") ||
            row.mint.startsWith("0x");
          const path = isRobinhood
            ? `/tokens/robinhood/${row.mint}`
            : `/tokens/${row.mint}`;
          return [
            {
              url: `${publicSite}${path}`,
              lastModified: row.updatedAt,
              changeFrequency: "daily" as const,
              priority: 0.86,
            },
          ];
        }),
      ];
    }
    return dedupeSitemapEntries(routes);
  }
  const agents = await getActiveAgentsSitemapChunk(numId);
  if (agents.length === 0) return [];
  return agents.map((agent) => ({
    url: `${publicSite}${agentPublicPath(agent)}`,
    lastModified: agent.lastActiveAt ?? agent.listedAt,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));
}
