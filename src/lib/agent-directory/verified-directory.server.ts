import "server-only";
import { prisma } from "@/lib/db";
import { extendAgentWhereNotBlocked } from "@/lib/agent-blocklist";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import { enrichVerifiedAgentsList } from "@/lib/verified-agents-list-enrichment";
import {
  VERIFIED_DIRECTORY_PAGE_SIZE,
  type VerifiedDirectoryPageData,
} from "@/lib/agent-directory/verified-directory";
export async function readVerifiedDirectoryPage(
  page = 1,
  perPage = VERIFIED_DIRECTORY_PAGE_SIZE,
): Promise<VerifiedDirectoryPageData> {
  const normalizedPage = Math.max(1, Math.trunc(page) || 1);
  const normalizedPerPage = Math.min(50, Math.max(1, Math.trunc(perPage) || VERIFIED_DIRECTORY_PAGE_SIZE));
  const where = await extendAgentWhereNotBlocked({
    isActive: true,
    OR: [{ isVerified: true }, { isPremiumVerified: true }],
  });
  const [rows, total] = await Promise.all([
    prisma.agent.findMany({
      where,
      select: {
        id: true,
        agentId: true,
        chainId: true,
        name: true,
        image: true,
        isVerified: true,
        isPremiumVerified: true,
        isVerifiedRevenue: true,
        perfLastComputedAt: true,
        archetype: true,
        archetypeAuto: true,
        agentMode: true,
        protocolTrustScore: true,
        agentRankScore: true,
        lastActiveAt: true,
        listedAt: true,
        x402Support: true,
        chain: { select: { name: true, shortName: true, color: true, icon: true } },
        services: { select: { name: true }, take: 12 },
      },
      orderBy: [{ listedAt: "desc" }, { id: "desc" }],
      skip: (normalizedPage - 1) * normalizedPerPage,
      take: normalizedPerPage,
    }),
    prisma.agent.count({ where }),
  ]);
  const ids = rows.map((row) => row.id);
  const [publishedCounts, enrichment] = await Promise.all([
    ids.length
      ? prisma.agentMcpOffer.groupBy({
          by: ["agentId"],
          where: { agentId: { in: ids }, isPublished: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    enrichVerifiedAgentsList(ids),
  ]);
  const publishedCountById = new Map(
    publishedCounts.map((row) => [row.agentId, row._count._all]),
  );
  const agents = rows.map((row) => {
    const extra = enrichment.get(row.id);
    return {
      id: row.id,
      agentId: row.agentId,
      chainId: row.chainId,
      name: row.name,
      image: sanitizeAgentImageUrl(row.image),
      slug: toAgentUrlSlug(row.name),
      profilePath: agentPublicPath({ chainId: row.chainId, agentId: row.agentId, name: row.name }),
      isVerified: row.isVerified,
      isPremiumVerified: row.isPremiumVerified,
      isVerifiedRevenue: row.isVerifiedRevenue,
      perfLastComputedAt: row.perfLastComputedAt?.toISOString() ?? null,
      archetype: row.archetype,
      archetypeAuto: row.archetypeAuto,
      agentMode: row.agentMode,
      protocolTrustScore: row.protocolTrustScore,
      agentRankScore: row.agentRankScore,
      lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
      listedAt: row.listedAt?.toISOString() ?? null,
      x402Support: row.x402Support,
      chain: row.chain,
      services: row.services,
      publishedMcpOfferCount: publishedCountById.get(row.id) ?? 0,
      deploymentCount: 1,
      serviceCount: extra?.serviceCount ?? row.services.length,
      devProofActive: extra?.devProofActive ?? false,
      x402Detected: extra?.x402Detected ?? false,
      x402Payable: extra?.x402Payable ?? false,
      githubConnected: extra?.githubConnected ?? false,
      devProofLastPushAt: extra?.devProofLastPushAt ?? null,
      devProofLatestPushMessage: extra?.devProofLatestPushMessage ?? null,
    };
  });
  return {
    agents,
    total,
    page: normalizedPage,
    perPage: normalizedPerPage,
    totalPages: Math.ceil(total / normalizedPerPage),
    generatedAt: new Date().toISOString(),
  };
}
