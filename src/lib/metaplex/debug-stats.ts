import { prisma } from "@/lib/db";
import { METAPLEX_LISTING_REGISTRY_SOURCE } from "@/lib/metaplex/config";
import { metaplexAgentListingWhere } from "@/lib/metaplex/detect";
export type MetaplexDebugStats = {
  counts: {
    listingRegistrySourceMetaplex: number;
    metaplexAssetAddressNotNull: number;
    metaplexVerifiedTrue: number;
    metaplexAgentTokenMintNotNull: number;
    activeListingMetaplexWhere: number;
  };
  latestAgents: Array<{
    id: number;
    name: string;
    metaplexAssetAddress: string | null;
    metaplexVerified: boolean;
    metaplexActive: boolean | null;
    metaplexAgentTokenMint: string | null;
    createdAt: string;
    metaplexLastIndexedAt: string | null;
  }>;
};
export async function loadMetaplexDebugStats(): Promise<MetaplexDebugStats> {
  const [
    listingRegistrySourceMetaplex,
    metaplexAssetAddressNotNull,
    metaplexVerifiedTrue,
    metaplexAgentTokenMintNotNull,
    activeListingMetaplexWhere,
    latestAgents,
  ] = await Promise.all([
    prisma.agent.count({ where: { listingRegistrySource: METAPLEX_LISTING_REGISTRY_SOURCE } }),
    prisma.agent.count({ where: { metaplexAssetAddress: { not: null } } }),
    prisma.agent.count({ where: { metaplexVerified: true } }),
    prisma.agent.count({ where: { metaplexAgentTokenMint: { not: null } } }),
    prisma.agent.count({ where: metaplexAgentListingWhere() }),
    prisma.agent.findMany({
      where: {
        OR: [
          { listingRegistrySource: METAPLEX_LISTING_REGISTRY_SOURCE },
          { metaplexAssetAddress: { not: null } },
        ],
      },
      orderBy: [{ metaplexLastIndexedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: {
        id: true,
        name: true,
        metaplexAssetAddress: true,
        metaplexVerified: true,
        metaplexActive: true,
        metaplexAgentTokenMint: true,
        createdAt: true,
        metaplexLastIndexedAt: true,
      },
    }),
  ]);
  return {
    counts: {
      listingRegistrySourceMetaplex,
      metaplexAssetAddressNotNull,
      metaplexVerifiedTrue,
      metaplexAgentTokenMintNotNull,
      activeListingMetaplexWhere,
    },
    latestAgents: latestAgents.map((row) => ({
      id: row.id,
      name: row.name,
      metaplexAssetAddress: row.metaplexAssetAddress,
      metaplexVerified: row.metaplexVerified,
      metaplexActive: row.metaplexActive,
      metaplexAgentTokenMint: row.metaplexAgentTokenMint,
      createdAt: row.createdAt.toISOString(),
      metaplexLastIndexedAt: row.metaplexLastIndexedAt?.toISOString() ?? null,
    })),
  };
}
