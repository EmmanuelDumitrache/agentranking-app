import type { Prisma } from "@/generated/prisma/client";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { prisma } from "@/lib/db";
import { metaplexAgentListingWhere } from "@/lib/metaplex/detect";
import { buildMetaplexDetail } from "@/lib/metaplex/snapshot";
import type { MetaplexDashboardAgentRow } from "@/lib/metaplex/types";
const METAPLEX_AGENT_WHERE = metaplexAgentListingWhere();
const DIRECTORY_PREVIEW_LIMIT = 100;
export type MetaplexDashboardPayload = {
  stats: {
    indexedCount: number;
    verifiedCount: number;
    boundTokenCount: number;
    lastIndexedAt: string | null;
  };
  agents: MetaplexDashboardAgentRow[];
  dashboardSource?: "build-stub";
};
function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : v;
}
function emptyMetaplexDashboardPayload(
  source?: MetaplexDashboardPayload["dashboardSource"],
): MetaplexDashboardPayload {
  return {
    stats: {
      indexedCount: 0,
      verifiedCount: 0,
      boundTokenCount: 0,
      lastIndexedAt: null,
    },
    agents: [],
    dashboardSource: source,
  };
}
const DIRECTORY_PREVIEW_AGENT_SELECT = {
  id: true,
  chainId: true,
  agentId: true,
  name: true,
  description: true,
  image: true,
  agentRankScore: true,
  owner: true,
  listingRegistrySource: true,
  metaplexSourceType: true,
  metaplexAssetAddress: true,
  metaplexAgentIdentityPda: true,
  metaplexAgentRegistrationUri: true,
  metaplexAgentTokenMint: true,
  metaplexAssetSignerPda: true,
  metaplexVerified: true,
  metaplexTokenBindingStatus: true,
  metaplexSupportedTrust: true,
  metaplexActive: true,
  metaplexLastIndexedAt: true,
  metaplexRawData: true,
  metaplexLaunchAddress: true,
  metaplexLaunchType: true,
  metaplexLaunchStatus: true,
  metaplexTradeUrl: true,
  metaplexBondingProgressPct: true,
  metaplexBondingProgressSource: true,
  metaplexBondingProgressUpdatedAt: true,
  _count: { select: { services: true } },
} as const;
type DirectoryPreviewAgentRow = {
  metaplexHasDexPair?: boolean | null;
} & Prisma.AgentGetPayload<{ select: typeof DIRECTORY_PREVIEW_AGENT_SELECT }>;
async function fetchDirectoryPreviewRows(): Promise<DirectoryPreviewAgentRow[]> {
  const query = {
    where: METAPLEX_AGENT_WHERE,
    orderBy: [
      { metaplexLastIndexedAt: "desc" as const },
      { listedAt: "desc" as const },
      { id: "desc" as const },
    ],
    take: DIRECTORY_PREVIEW_LIMIT,
  };
  return prisma.agent.findMany({
    ...query,
    select: { ...DIRECTORY_PREVIEW_AGENT_SELECT, metaplexHasDexPair: true },
  });
}
function mapDirectoryPreviewRow(row: DirectoryPreviewAgentRow): MetaplexDashboardAgentRow {
  return {
    id: row.id,
    chainId: row.chainId,
    agentId: row.agentId,
    name: row.name,
    description: row.description ?? "",
    slug: toAgentUrlSlug(row.name),
    profilePath: agentPublicPath(row),
    agentRankScore: row.agentRankScore,
    image: row.image ?? "",
    metaplexVerified: row.metaplexVerified,
    metaplexAssetAddress: row.metaplexAssetAddress,
    metaplexAgentTokenMint: row.metaplexAgentTokenMint,
    metaplexTokenBindingStatus: row.metaplexTokenBindingStatus,
    metaplexLastIndexedAt: toIso(row.metaplexLastIndexedAt),
    serviceCount: row._count.services,
    metaplex: buildMetaplexDetail({
      owner: row.owner,
      listingRegistrySource: row.listingRegistrySource,
      metaplexSourceType: row.metaplexSourceType,
      metaplexAssetAddress: row.metaplexAssetAddress,
      metaplexAgentIdentityPda: row.metaplexAgentIdentityPda,
      metaplexAgentRegistrationUri: row.metaplexAgentRegistrationUri,
      metaplexAgentTokenMint: row.metaplexAgentTokenMint,
      metaplexAssetSignerPda: row.metaplexAssetSignerPda,
      metaplexVerified: row.metaplexVerified,
      metaplexTokenBindingStatus: row.metaplexTokenBindingStatus,
      metaplexSupportedTrust: row.metaplexSupportedTrust,
      metaplexActive: row.metaplexActive,
      metaplexLastIndexedAt: row.metaplexLastIndexedAt,
      metaplexRawData: row.metaplexRawData,
      metaplexLaunchAddress: row.metaplexLaunchAddress,
      metaplexLaunchType: row.metaplexLaunchType,
      metaplexLaunchStatus: row.metaplexLaunchStatus,
      metaplexTradeUrl: row.metaplexTradeUrl,
      metaplexBondingProgressPct: row.metaplexBondingProgressPct,
      metaplexBondingProgressSource: row.metaplexBondingProgressSource,
      metaplexBondingProgressUpdatedAt: row.metaplexBondingProgressUpdatedAt,
      metaplexHasDexPair: row.metaplexHasDexPair ?? null,
    }),
  };
}
async function loadDirectoryPreviewAgents(): Promise<MetaplexDashboardAgentRow[]> {
  const rows = await fetchDirectoryPreviewRows();
  return rows.map(mapDirectoryPreviewRow);
}
async function loadMetaplexDashboardFromDb(): Promise<MetaplexDashboardPayload> {
  const [indexedCount, globalVerifiedCount, globalBoundCount, lastIndexedRow, agents] =
    await Promise.all([
      prisma.agent.count({ where: METAPLEX_AGENT_WHERE }),
      prisma.agent.count({
        where: { ...METAPLEX_AGENT_WHERE, metaplexVerified: true },
      }),
      prisma.agent.count({
        where: {
          ...METAPLEX_AGENT_WHERE,
          OR: [{ metaplexTokenBindingStatus: "bound" }, { metaplexAgentTokenMint: { not: null } }],
        },
      }),
      prisma.agent.findFirst({
        where: { ...METAPLEX_AGENT_WHERE, metaplexLastIndexedAt: { not: null } },
        orderBy: { metaplexLastIndexedAt: "desc" },
        select: { metaplexLastIndexedAt: true },
      }),
      loadDirectoryPreviewAgents(),
    ]);
  return {
    stats: {
      indexedCount,
      verifiedCount: globalVerifiedCount,
      boundTokenCount: globalBoundCount,
      lastIndexedAt: toIso(lastIndexedRow?.metaplexLastIndexedAt ?? null),
    },
    agents,
  };
}
export async function loadMetaplexDashboardData(): Promise<MetaplexDashboardPayload> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return emptyMetaplexDashboardPayload("build-stub");
  }
  return loadMetaplexDashboardFromDb();
}
