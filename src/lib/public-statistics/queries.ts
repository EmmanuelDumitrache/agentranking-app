import "server-only";
import { prisma } from "@/lib/db";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import {
  computeStatsAggregatesOnly,
  computeStatsListsOnly,
} from "@/lib/home-stats-compute";
import { computeTopByChainLive } from "@/lib/top-by-chain-live";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import {
  buildPowerBoostListPayload,
  powerBoostAgentSelect,
  type PowerBoostAgentRow,
  type PowerBoostListPayload,
} from "@/lib/powerboost-payload";
import { attachSapTwinMatchToAgentsSync, getCachedSapTwinIndex } from "@/lib/sap-name-twin";
import {
  hydratePowerBoostCoordinates,
  mapPowerBoostCoordinateRows,
  type PowerBoostCoordinate,
  type PowerBoostCoordinateRow,
} from "@/lib/public-statistics/powerboost-coordinates";
export type CountersPayload = Awaited<ReturnType<typeof computeStatsAggregatesOnly>>;
export type StatsListsPayload = Awaited<ReturnType<typeof computeStatsListsOnly>>;
export type StatsPayload = CountersPayload & StatsListsPayload;
export type TopByChainPayload = Awaited<ReturnType<typeof computeTopByChainLive>>;
export type TickerAgent = {
  agentId: number;
  chainId: number;
  name: string;
  rank: number | null;
  score: number;
  powerScore: number;
  activeBoosts: number;
  adminPowerAdjust: number;
  slug: string;
  profilePath: string;
  chain: { shortName: string; color: string; icon: string };
  daoVotes?: number;
};
export type TickerPayload = {
  dao: TickerAgent[];
  hot: TickerAgent[];
  trending: TickerAgent[];
  latest: TickerAgent[];
};
export type PowerBoostQueryInput = {
  page: number;
  perPage: number;
  activitySince?: Date;
};
type HydratedPowerBoostAgent = PowerBoostAgentRow & {
  chain: { shortName: string; color: string; icon: string };
};
const TICKER_AGENT_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  rank: true,
  score: true,
  powerScore: true,
  activeBoosts: true,
  adminPowerAdjust: true,
  chain: { select: { shortName: true, color: true, icon: true } },
} as const;
export async function loadCountersPayload(): Promise<CountersPayload> {
  return computeStatsAggregatesOnly();
}
export async function loadStatsListsPayload(): Promise<StatsListsPayload> {
  return computeStatsListsOnly();
}
export async function loadTopByChainPayload(): Promise<TopByChainPayload> {
  return computeTopByChainLive();
}
async function loadPowerBoostCoordinates(input: PowerBoostQueryInput, activeAt: Date): Promise<{
  coordinates: PowerBoostCoordinate[];
  total: number;
}> {
  const skip = (input.page - 1) * input.perPage;
  const cutoff = input.activitySince ?? null;
  const rows = await prisma.$queryRaw<PowerBoostCoordinateRow[]>`
    WITH holder_votes AS (
      SELECT
        h."agentId" AS id,
        SUM(GREATEST(COALESCE(h."boostUnits", 0), 0))::bigint AS staking_votes
      FROM "ArHolderAgentPerk" h
      WHERE h."perkType" = 'power_boost'
        AND h."status" = 'active'
        AND (h."expiresAt" IS NULL OR h."expiresAt" > ${activeAt})
      GROUP BY h."agentId"
    ),
    candidate_ids AS (
      SELECT a.id
      FROM "Agent" a
      WHERE a."isActive" = TRUE
        AND a."agentId" <> 88888
        AND (${cutoff}::timestamptz IS NULL OR a."lastActiveAt" >= ${cutoff}::timestamptz)
        AND (a."activeBoosts" > 0 OR a."adminPowerAdjust" <> 0)
      UNION
      SELECT a.id
      FROM holder_votes hv
      JOIN "Agent" a ON a.id = hv.id
      WHERE a."isActive" = TRUE
        AND a."agentId" <> 88888
        AND (${cutoff}::timestamptz IS NULL OR a."lastActiveAt" >= ${cutoff}::timestamptz)
        AND hv.staking_votes > 0
    ),
    scored AS (
      SELECT
        a.id,
        (
          GREATEST(COALESCE(a."activeBoosts", 0), 0)::bigint
          + GREATEST(COALESCE(a."adminPowerAdjust", 0), 0)::bigint
          + GREATEST(COALESCE(hv.staking_votes, 0), 0)::bigint
        ) AS dao_votes,
        GREATEST(COALESCE(hv.staking_votes, 0), 0)::bigint AS staking_votes
      FROM candidate_ids c
      JOIN "Agent" a ON a.id = c.id
      LEFT JOIN holder_votes hv ON hv.id = a.id
    ),
    ranked AS (
      SELECT
        s.id,
        s.dao_votes,
        s.staking_votes,
        ROW_NUMBER() OVER (ORDER BY s.dao_votes DESC, s.id ASC)::bigint AS rank
      FROM scored s
      WHERE s.dao_votes > 0
    ),
    totals AS (
      SELECT COUNT(*)::bigint AS total
      FROM ranked
    )
    SELECT
      page.id AS id,
      page.dao_votes AS "daoVotes",
      page.staking_votes AS "stakingVotes",
      page.rank AS rank,
      totals.total AS total
    FROM totals
    LEFT JOIN LATERAL (
      SELECT r.id, r.dao_votes, r.staking_votes, r.rank
      FROM ranked r
      ORDER BY r.rank ASC
      OFFSET ${skip}
      LIMIT ${input.perPage}
    ) page ON TRUE
    ORDER BY page.rank ASC NULLS LAST
  `;
  return mapPowerBoostCoordinateRows(rows);
}
async function loadPowerBoostRankedRows(input: PowerBoostQueryInput): Promise<{
  agents: HydratedPowerBoostAgent[];
  total: number;
}> {
  const activeAt = new Date();
  const { coordinates, total } = await loadPowerBoostCoordinates(input, activeAt);
  if (coordinates.length === 0) return { agents: [], total };
  const rows = await prisma.agent.findMany({
    where: { id: { in: coordinates.map((coordinate) => coordinate.id) }, isActive: true },
    select: powerBoostAgentSelect(activeAt),
  });
  const agents = hydratePowerBoostCoordinates(coordinates, rows) as HydratedPowerBoostAgent[];
  return { agents, total };
}
export async function loadPowerBoostPayload(input: PowerBoostQueryInput): Promise<PowerBoostListPayload> {
  const { agents, total } = await loadPowerBoostRankedRows(input);
  const payload = buildPowerBoostListPayload(agents, total, input.page, input.perPage);
  const sapTwinIndex = await getCachedSapTwinIndex();
  return {
    ...payload,
    agents: attachSapTwinMatchToAgentsSync(payload.agents, sapTwinIndex),
  };
}
function mapTickerAgent(agent: {
  agentId: number;
  chainId: number;
  name: string;
  rank: number | null;
  score: number;
  powerScore?: number | null;
  activeBoosts?: number | null;
  adminPowerAdjust?: number | null;
  chain: { shortName: string; color: string; icon: string };
}): TickerAgent {
  return {
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    rank: agent.rank,
    score: agent.score,
    powerScore: Number(agent.powerScore ?? 0),
    activeBoosts: Number(agent.activeBoosts ?? 0),
    adminPowerAdjust: Number(agent.adminPowerAdjust ?? 0),
    slug: toAgentUrlSlug(agent.name),
    profilePath: agentPublicPath(agent),
    chain: agent.chain,
  };
}
export async function loadTickerPayload(): Promise<TickerPayload> {
  const publicWhere = await extendAgentWhereIndexable();
  const [daoRows, trendingAgents, latestAgents] = await Promise.all([
    prisma.daoLeaderboardLive.findMany({
      where: { daoVotes: { gt: 0 }, agent: publicWhere },
      orderBy: [{ rank: "asc" }, { agentId: "asc" }],
      take: 6,
      select: {
        daoVotes: true,
        rank: true,
        agent: { select: TICKER_AGENT_SELECT },
      },
    }),
    prisma.agent.findMany({
      where: publicWhere,
      orderBy: [{ hotScore: "desc" }, { score: "desc" }, { id: "asc" }],
      take: 6,
      select: TICKER_AGENT_SELECT,
    }),
    prisma.agent.findMany({
      where: publicWhere,
      orderBy: [{ listedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 6,
      select: TICKER_AGENT_SELECT,
    }),
  ]);
  const dao = daoRows.map((row) => {
    const mapped = mapTickerAgent(row.agent);
    return {
      ...mapped,
      rank: row.rank,
      daoVotes: row.daoVotes,
      powerScore: row.daoVotes,
    };
  });
  return {
    dao,
    hot: dao,
    trending: trendingAgents.map(mapTickerAgent),
    latest: latestAgents.map(mapTickerAgent),
  };
}
