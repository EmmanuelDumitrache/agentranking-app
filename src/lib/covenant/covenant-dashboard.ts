import { prisma } from "@/lib/db";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { resolveImageUrl } from "@/lib/image-utils";
import { COVENANT_VERIFICATION_SNAPSHOT_KEY } from "@/lib/covenant/config";
import { covenantAgentListingWhere } from "@/lib/covenant/detect";
import { buildCovenantDetail } from "@/lib/covenant/snapshot";
import { isFullCovenantVerifiedStatus } from "@/lib/covenant/status";
import type { CovenantDetailPayload } from "@/lib/covenant/types";
import {
  buildDevCovenantDashboardPayload,
  isDevCovenantPreviewEnabled,
} from "@/lib/dev-covenant-preview-agent";
import { getOrInsertComputed } from "@/lib/map-upsert";
const COVENANT_AGENT_WHERE = covenantAgentListingWhere();
const COVENANT_DASHBOARD_TABLE_LIMIT = 500;
/** Fail fast in local dev so /covenant can show preview agents instead of hanging. */
export type CovenantDashboardAgentRow = {
  id: number;
  chainId: number;
  agentId: number;
  name: string;
  slug: string;
  profilePath: string;
  agentRankScore: number;
  image: string;
  sapAgentPda: string | null;
  sapProtocols: string[];
  x402Support: boolean;
  sapLastSyncedAt: string | null;
  agentURI: string | null;
  covenant: CovenantDetailPayload;
};
export type CovenantDashboardPayload = {
  stats: {
    indexedCount: number;
    verifiedCount: number;
    pendingCount: number;
    x402EnabledCount: number;
    lastIndexedAt: string | null;
    lastVerifiedAt: string | null;
  };
  agents: CovenantDashboardAgentRow[];
  agentsHasMore: boolean;
  dashboardSource?: "build-stub" | "dev-preview";
};
function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : v;
}
const COVENANT_AGENT_SELECT = {
  id: true,
  chainId: true,
  agentId: true,
  name: true,
  agentRankScore: true,
  image: true,
  sapAgentPda: true,
  sapProtocols: true,
  sapCapabilities: true,
  x402Support: true,
  sapLastSyncedAt: true,
  agentURI: true,
} as const;
/** SAP rows with Covenant capabilities but missing runtime in protocols or detection metadata. */
async function covenantCapabilityOnlyAgentIds(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT DISTINCT a.id
    FROM "Agent" a
    JOIN agent_sap_capabilities c ON c.agent_db_id = a.id
    WHERE a."isActive" = true
      AND a.sap_agent_pda IS NOT NULL
      AND NOT ('covenant.runtime/v1' = ANY(a.sap_protocols))
      AND NOT EXISTS (
        SELECT 1 FROM "AgentMetadata" m
        WHERE m."agentId" = a.id
          AND m.key = 'covenant_detected_at'
      )
      AND (
        c.protocol ILIKE 'covenant%'
        OR c.capability_key ILIKE 'covenant:%'
      )
  `;
  return rows.map((r) => r.id);
}
async function loadCovenantDashboardFromDb(): Promise<CovenantDashboardPayload> {
  const [listedCount, listedRows, capabilityOnlyIds] = await Promise.all([
    prisma.agent.count({ where: COVENANT_AGENT_WHERE }),
    prisma.agent.findMany({
      where: COVENANT_AGENT_WHERE,
      orderBy: [{ agentRankScore: "desc" }, { sapLastSyncedAt: "desc" }, { listedAt: "desc" }],
      take: COVENANT_DASHBOARD_TABLE_LIMIT,
      select: COVENANT_AGENT_SELECT,
    }),
    covenantCapabilityOnlyAgentIds(),
  ]);
  const listedIdSet = new Set(listedRows.map((r) => r.id));
  const extraIds = capabilityOnlyIds.filter((id) => !listedIdSet.has(id)).slice(0, 50);
  const extraRows =
    extraIds.length > 0
      ? await prisma.agent.findMany({
          where: { id: { in: extraIds } },
          select: COVENANT_AGENT_SELECT,
        })
      : [];
  const agentRows = [...listedRows, ...extraRows].sort((a, b) => {
    if (b.agentRankScore !== a.agentRankScore) return b.agentRankScore - a.agentRankScore;
    const bSync = b.sapLastSyncedAt?.getTime() ?? 0;
    const aSync = a.sapLastSyncedAt?.getTime() ?? 0;
    return bSync - aSync;
  });
  const totalCount = listedCount + extraIds.length;
  const agentIds = agentRows.map((a) => a.id);
  const metadataRows =
    agentIds.length > 0
      ? await prisma.agentMetadata.findMany({
          where: {
            agentId: { in: agentIds },
            key: COVENANT_VERIFICATION_SNAPSHOT_KEY,
          },
          select: { agentId: true, key: true, value: true },
        })
      : [];
  const metadataByAgentId = new Map<number, Array<{ key: string; value: string }>>();
  for (const row of metadataRows) {
    getOrInsertComputed(metadataByAgentId, row.agentId, () => []).push({ key: row.key, value: row.value });
  }
  let verifiedCount = 0;
  let pendingCount = 0;
  let x402EnabledCount = 0;
  let lastIndexedMs = 0;
  let lastVerifiedMs = 0;
  const agents: CovenantDashboardAgentRow[] = agentRows.map((row) => {
    const protocols = row.sapProtocols ?? [];
    const meta = metadataByAgentId.get(row.id);
    const covenant = buildCovenantDetail(
      { sapProtocols: protocols, sapCapabilities: row.sapCapabilities },
      meta,
    );
    if (isFullCovenantVerifiedStatus(covenant.status)) {
      verifiedCount += 1;
    } else if (covenant.isCovenant) {
      pendingCount += 1;
    }
    if (row.x402Support) x402EnabledCount += 1;
    const syncedMs = row.sapLastSyncedAt?.getTime() ?? 0;
    if (syncedMs > lastIndexedMs) lastIndexedMs = syncedMs;
    const checkedMs = covenant.rootCheckedAt ? new Date(covenant.rootCheckedAt).getTime() : 0;
    if (Number.isFinite(checkedMs) && checkedMs > lastVerifiedMs) lastVerifiedMs = checkedMs;
    return {
      id: row.id,
      chainId: row.chainId,
      agentId: row.agentId,
      name: row.name,
      slug: toAgentUrlSlug(row.name),
      profilePath: agentPublicPath(row),
      agentRankScore: row.agentRankScore,
      image: resolveImageUrl(row.image) ?? "",
      sapAgentPda: row.sapAgentPda,
      sapProtocols: protocols,
      x402Support: row.x402Support,
      sapLastSyncedAt: toIso(row.sapLastSyncedAt),
      agentURI: row.agentURI,
      covenant,
    };
  });
  return {
    stats: {
      indexedCount: totalCount,
      verifiedCount,
      pendingCount,
      x402EnabledCount,
      lastIndexedAt: lastIndexedMs > 0 ? new Date(lastIndexedMs).toISOString() : null,
      lastVerifiedAt: lastVerifiedMs > 0 ? new Date(lastVerifiedMs).toISOString() : null,
    },
    agents,
    agentsHasMore: totalCount > agents.length,
  };
}
export async function loadCovenantDashboardData(): Promise<CovenantDashboardPayload> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return {
      stats: {
        indexedCount: 0,
        verifiedCount: 0,
        pendingCount: 0,
        x402EnabledCount: 0,
        lastIndexedAt: null,
        lastVerifiedAt: null,
      },
      agents: [],
      agentsHasMore: false,
      dashboardSource: "build-stub",
    };
  }
  const devPreview = isDevCovenantPreviewEnabled();
  const payload = await loadCovenantDashboardFromDb();
  if (devPreview && payload.agents.length === 0) {
    return buildDevCovenantDashboardPayload();
  }
  return payload;
}
