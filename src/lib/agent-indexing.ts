import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { extendAgentWhereNotBlocked } from "@/lib/agent-blocklist";
/** Minimum trimmed description length for sitemap when agent is not verified/premium. */
export const SITEMAP_MIN_DESCRIPTION_CHARS = 80;
/**
 * Public SEO eligibility for agent profile URLs.
 *
 * Keep sitemap, route-identity resolution, metadata, and render paths aligned so Google
 * does not discover URLs that the public app later serves as 404/noindex.
 */
export async function extendAgentWhereIndexable(
  base: Prisma.AgentWhereInput = {},
  opts?: { useCache?: boolean }
): Promise<Prisma.AgentWhereInput> {
  return extendAgentWhereNotBlocked(
    {
      ...base,
      isActive: true,
    },
    opts
  );
}
/**
 * Stricter subset for sitemap.xml: active, not blocklisted, and
 * verified OR premium OR rich description (see {@link agentRowMeetsSitemapEligibility}).
 */
export async function extendAgentWhereSitemapEligible(
  base: Prisma.AgentWhereInput = {},
  opts?: { useCache?: boolean }
): Promise<Prisma.AgentWhereInput> {
  return extendAgentWhereNotBlocked(
    {
      ...base,
      isActive: true,
      OR: [
        { isVerified: true },
        { isPremiumVerified: true },
        { NOT: { description: "" } },
      ],
    },
    opts
  );
}
export function agentDescriptionMeetsSitemapRichness(
  description: string | null | undefined
): boolean {
  return (description ?? "").trim().length >= SITEMAP_MIN_DESCRIPTION_CHARS;
}
export function agentRowMeetsSitemapEligibility(row: {
  isVerified: boolean;
  isPremiumVerified: boolean;
  description: string;
}): boolean {
  if (row.isVerified || row.isPremiumVerified) return true;
  return agentDescriptionMeetsSitemapRichness(row.description);
}
