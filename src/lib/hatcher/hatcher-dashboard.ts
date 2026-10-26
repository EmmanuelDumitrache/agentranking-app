import { prisma } from "@/lib/db";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { resolveImageUrl } from "@/lib/image-utils";
import { hatcherAgentListingWhere } from "@/lib/hatcher/detect";
import { buildHatcherDetail } from "@/lib/hatcher/snapshot";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { isHatcherActiveStatus, isHatcherSleepingStatus } from "@/lib/hatcher/hatcher-status";
import { getOrInsertComputed } from "@/lib/map-upsert";
const HATCHER_AGENT_WHERE = hatcherAgentListingWhere();
const HATCHER_DASHBOARD_TABLE_LIMIT = 500;
export type {
  HatcherDashboardAgentRow,
  HatcherDashboardPayload,
  HatcherStatusFilter,
} from "@/lib/hatcher/dashboard-types";
import type { HatcherDashboardAgentRow, HatcherDashboardPayload, HatcherStatusFilter } from "@/lib/hatcher/dashboard-types";
function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : v;
}
function statusRank(status: string): number {
  const s = status.toLowerCase();
  if (isHatcherActiveStatus(s)) return 0;
  if (isHatcherSleepingStatus(s)) return 1;
  return 2;
}
const HATCHER_AGENT_SELECT = {
  id: true,
  chainId: true,
  agentId: true,
  name: true,
  description: true,
  score: true,
  image: true,
  owner: true,
  listedAt: true,
  listingRegistrySource: true,
} as const;
const EMPTY_STATS: HatcherDashboardPayload["stats"] = {
  indexedCount: 0,
  activeCount: 0,
  sleepingCount: 0,
  publicChatCount: 0,
  passportCount: 0,
  mcpCount: 0,
  totalMessages: 0,
  lastIndexedAt: null,
};
export async function loadHatcherDashboardFromDb(
  statusFilter: HatcherStatusFilter = "all",
): Promise<HatcherDashboardPayload> {
  const rows = await prisma.agent.findMany({
    where: HATCHER_AGENT_WHERE,
    orderBy: [{ score: "desc" }, { listedAt: "desc" }],
    take: HATCHER_DASHBOARD_TABLE_LIMIT,
    select: HATCHER_AGENT_SELECT,
  });
  const totalCount = await prisma.agent.count({ where: HATCHER_AGENT_WHERE });
  const agentIds = rows.map((r) => r.id);
  const metadataRows =
    agentIds.length > 0
      ? await prisma.agentMetadata.findMany({
          where: { agentId: { in: agentIds }, key: "hatcher" },
          select: { agentId: true, key: true, value: true },
        })
      : [];
  const metadataByAgentId = new Map<number, Array<{ key: string; value: string }>>();
  for (const row of metadataRows) {
    getOrInsertComputed(metadataByAgentId, row.agentId, () => []).push({ key: row.key, value: row.value });
  }
  let activeCount = 0;
  let sleepingCount = 0;
  let publicChatCount = 0;
  let passportCount = 0;
  let mcpCount = 0;
  let totalMessages = 0;
  let lastIndexedMs = 0;
  const agents: HatcherDashboardAgentRow[] = [];
  for (const row of rows) {
    const meta = metadataByAgentId.get(row.id);
    const hatcher = buildHatcherDetail(
      { chainId: row.chainId, listingRegistrySource: row.listingRegistrySource },
      meta,
    );
    const snap = hatcher.hatcher;
    const status = snap?.status ?? "unknown";
    if (isHatcherActiveStatus(status)) activeCount += 1;
    else if (isHatcherSleepingStatus(status)) sleepingCount += 1;
    if (snap?.publicChatEnabled) publicChatCount += 1;
    const passportSnap = snap?.passportSnapshot;
    const mcpSnap = snap?.mcpManifestSnapshot;
    if (passportSnap && typeof passportSnap === "object") passportCount += 1;
    if (mcpSnap && typeof mcpSnap === "object") mcpCount += 1;
    totalMessages += snap?.messageCount ?? 0;
    const indexedMs = snap?.lastIndexedAt ? Date.parse(snap.lastIndexedAt) : 0;
    if (Number.isFinite(indexedMs) && indexedMs > lastIndexedMs) lastIndexedMs = indexedMs;
    if (statusFilter === "active" && !isHatcherActiveStatus(status)) continue;
    if (statusFilter === "sleeping" && !isHatcherSleepingStatus(status)) continue;
    agents.push({
      id: row.id,
      chainId: row.chainId,
      agentId: row.agentId,
      name: row.name,
      slug: toAgentUrlSlug(row.name),
      profilePath: agentPublicPath(row),
      description: row.description ?? "",
      score: row.score,
      image: resolveImageUrl(row.image) ?? "",
      owner: row.owner,
      listedAt: toIso(row.listedAt),
      hatcher,
    });
  }
  agents.sort((a, b) => {
    const sa = a.hatcher.hatcher?.status ?? "";
    const sb = b.hatcher.hatcher?.status ?? "";
    const rankDiff = statusRank(sa) - statusRank(sb);
    if (rankDiff !== 0) return rankDiff;
    return b.score - a.score;
  });
  return {
    stats: {
      indexedCount: totalCount,
      activeCount,
      sleepingCount,
      publicChatCount,
      passportCount,
      mcpCount,
      totalMessages,
      lastIndexedAt: lastIndexedMs > 0 ? new Date(lastIndexedMs).toISOString() : null,
    },
    agents,
    agentsHasMore: totalCount > agents.length,
    dashboardSource: "database",
  };
}
export async function loadHatcherDashboardData(
  statusFilter: HatcherStatusFilter = "all",
): Promise<HatcherDashboardPayload> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return {
      stats: EMPTY_STATS,
      agents: [],
      agentsHasMore: false,
      dashboardSource: "build-stub",
    };
  }
  const started = Date.now();
  const payload = await withTransientPoolRetry(() => loadHatcherDashboardFromDb(statusFilter));
  if (process.env.NODE_ENV === "development") {
    console.info(
      JSON.stringify({
        route: "/hatcher",
        indexedCount: payload.stats.indexedCount,
        agentRows: payload.agents.length,
        durationMs: Date.now() - started,
        dashboardSource: payload.dashboardSource,
      }),
    );
  }
  return payload;
}
export { hatcherProfilePath } from "@/lib/hatcher/paths";
