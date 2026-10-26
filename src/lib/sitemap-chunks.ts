import "server-only";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import {
  agentRowMeetsSitemapEligibility,
  extendAgentWhereSitemapEligible,
} from "@/lib/agent-indexing";
/** Google allows up to 50k URLs per sitemap; stay well under for headroom. */
export const SITEMAP_AGENT_CHUNK_SIZE = 10_000;
export type SitemapAgentRow = {
  id: number;
  chainId: number;
  agentId: number;
  name: string;
  description: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  score: number;
  lastActiveAt: Date | null;
  listedAt: Date;
};
/**
 * During `next build` (NEXT_PHASE=phase-production-build) Next forks static-generation workers;
 * pretending we had many agent-sitemap slices caused concurrent keyset scans and exhausted the
 * the database connection pool.
 *
 * Omit agent chunks in the **build artifact only** (`count`→0 ⇒ only sitemap id 0).
 * `/api/sitemap-index` and ISR invoke this with `NEXT_PHASE` unset, so production discovers the
 * real chunk IDs and URLs.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}
export async function countActiveAgentsForSitemap(): Promise<number> {
  if (isBuildPhase()) return 0;
  const where = await extendAgentWhereSitemapEligible();
  return withTransientPoolRetry(() => prisma.agent.count({ where }));
}
export function agentSitemapPageCount(agentCount: number): number {
  if (agentCount <= 0) return 0;
  return Math.ceil(agentCount / SITEMAP_AGENT_CHUNK_SIZE);
}
/**
 * IDs for Next.js `generateSitemaps`: 0 = static/news/chains; 1..N = Agent URL chunks (numeric identities with current display-slug segments).
 */
export async function buildSitemapRouteIds(): Promise<{ id: number }[]> {
  const count = await countActiveAgentsForSitemap();
  const pages = agentSitemapPageCount(count);
  const ids: { id: number }[] = [{ id: 0 }];
  for (let p = 1; p <= pages; p++) {
    ids.push({ id: p });
  }
  return ids;
}
/**
 * Keyset-style scan: advance (page1 - 1) full chunks by primary key, then return the next chunk.
 * Avoids OFFSET on large tables (better for Postgres IO on sitemap generation).
 */
export async function getActiveAgentsSitemapChunk(page1Based: number): Promise<SitemapAgentRow[]> {
  if (page1Based < 1) return [];
  let afterId = 0;
  for (let p = 1; p < page1Based; p++) {
    const where = await extendAgentWhereSitemapEligible({
      ...(afterId > 0 ? { id: { gt: afterId } } : {}),
    });
    const page = await prisma.agent.findMany({
      where,
      orderBy: { id: "asc" },
      take: SITEMAP_AGENT_CHUNK_SIZE,
      select: { id: true },
    });
    if (page.length === 0) return [];
    afterId = page.at(-1)?.id ?? afterId;
  }
  const where = await extendAgentWhereSitemapEligible({
    ...(afterId > 0 ? { id: { gt: afterId } } : {}),
  });
  const rows = await prisma.agent.findMany({
    where,
    orderBy: { id: "asc" },
    take: SITEMAP_AGENT_CHUNK_SIZE,
    select: {
      id: true,
      chainId: true,
      agentId: true,
      name: true,
      description: true,
      isVerified: true,
      isPremiumVerified: true,
      score: true,
      lastActiveAt: true,
      listedAt: true,
    },
  });
  return rows.filter(agentRowMeetsSitemapEligibility);
}
