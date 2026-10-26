import { prisma } from "@/lib/db";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import {
  countUniqueSapIdentities,
  dedupeSapAgentsByIdentity,
  type SapCanonicalAgentRow,
} from "@/lib/sap-canonical-agents";
import {
  getOobeExplorerStatus,
  getOobeNetworkMetrics,
  getOobeVolume,
  getOobeVolumeDaily,
  getOobeEscrowAlerts,
  oobeAgentsCursorStale,
  listOobeExplorerAgents,
  type OobeExplorerAgentRow,
} from "@/lib/oobe-explorer-client";
import { skipOobeExplorerCalls } from "@/lib/fast-local";
const SAP_AGENT_WHERE = { sapVerified: true, isActive: true } as const;
/** Max rows for `/sap` directory table (ordered by trust score). */
const SAP_DASHBOARD_AGENT_TABLE_LIMIT = 500;
/** Normalized OOBE Explorer REST slice for `/sap` (server-fetched). */
export type SapDashboardOobeExplorer = {
  available: boolean;
  error?: string;
  fetchedAt: string;
  globalStatus: string | null;
  agentsIndexerStale: boolean;
  metaWarnings: string[];
  networkMetrics: {
    totalAgents: string;
    activeAgents: string;
    totalTools: number;
    totalCapabilities: number;
    totalProtocols?: number;
    totalVolumeLamports: string;
    totalCallsSettled: string;
    activeEscrows: number;
    totalEscrows: number;
  } | null;
  volume: {
    totalSettledLamports: string;
    totalSettledSol?: string;
    totalCallsSettled: string;
    activeEscrows: number;
    fundedEscrows?: number;
    totalEscrows: number;
  } | null;
  volumeDailySeries: Array<{ day: string; amount: string }>;
  escrowAlerts: {
    expiringCount: number;
    lowBalanceCount: number;
  } | null;
  /** `GET /api/v1/agents` at OOBE — same source as network “Agents: 22”; not Postgres. */
  liveAgentsFromApi: Array<{
    pda: string;
    name: string;
    wallet: string | null;
    isActive: boolean | null;
    reputationScore: number | null;
  }>;
  /** When agent list HTTP fails but other Explorer calls succeeded. */
  liveAgentsListError?: string;
};
export type SapDashboardPayload = {
  totals: {
    /** Distinct Agent records after display-name grouping for the SAP dashboard only. */
    sapUniqueAgents: number;
    /** On-chain SAP registration rows in AgentRanking DB (may include duplicate normalized names). */
    sapVerifiedAgents: number;
    capabilitiesRegistered: number;
    /** Sum of `perfTotalVolumeUsd` for SAP listings — execution-wallet volume proxy, not SAP settle volume. */
    executionWalletVolumeUsd: number;
    executionTxCountSum: number | null;
  };
  recentSyncs: Array<{
    id: string;
    syncedAt: string;
    agentsFound: number;
    agentsUpserted: number;
    durationMs: number;
    errors: unknown;
  }>;
  /** UTC date YYYY-MM-DD */
  growth: Array<{ day: string; count: number }>;
  /** Live OOBE Explorer API (network, volume, alerts) — separate from AgentRanking DB totals above. */
  oobeExplorer: SapDashboardOobeExplorer;
  /** SAP agents for the directory table — one row per dashboard display-name group (capped, score-desc). */
  sapAgentsTable: Array<SapCanonicalAgentRow & { slug: string; profilePath: string }>;
  /** True when more unique SAP agents exist in DB than `sapAgentsTable.length`. */
  sapAgentsTableHasMore: boolean;
  /**
   * Present only when RSC skipped DB during `next build`.
   * The browser should fetch `GET /api/sap/dashboard` once to hydrate real stats after deploy artifact.
   */
  dashboardSource?: "build-stub";
};
function numFromBigint(v: bigint | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}
function numStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
function parseOobeNetworkMetrics(data: unknown): SapDashboardOobeExplorer["networkMetrics"] {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const totalAgents = numStr(o.totalAgents);
  const activeAgents = numStr(o.activeAgents);
  if (!totalAgents || !activeAgents) return null;
  return {
    totalAgents,
    activeAgents,
    totalTools: typeof o.totalTools === "number" ? o.totalTools : Number(o.totalTools) || 0,
    totalCapabilities: typeof o.totalCapabilities === "number" ? o.totalCapabilities : Number(o.totalCapabilities) || 0,
    totalProtocols:
      o.totalProtocols == null ? undefined : typeof o.totalProtocols === "number"
        ? o.totalProtocols
        : Number(o.totalProtocols) || 0,
    totalVolumeLamports: numStr(o.totalVolumeLamports) ?? "—",
    totalCallsSettled: numStr(o.totalCallsSettled) ?? "—",
    activeEscrows: typeof o.activeEscrows === "number" ? o.activeEscrows : Number(o.activeEscrows) || 0,
    totalEscrows: typeof o.totalEscrows === "number" ? o.totalEscrows : Number(o.totalEscrows) || 0,
  };
}
function parseOobeVolume(data: unknown): SapDashboardOobeExplorer["volume"] {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const totalSettledLamports = numStr(o.totalSettledLamports);
  const totalCallsSettled = numStr(o.totalCallsSettled);
  if (!totalSettledLamports || !totalCallsSettled) return null;
  return {
    totalSettledLamports,
    totalSettledSol: numStr(o.totalSettledSol) ?? undefined,
    totalCallsSettled,
    activeEscrows: typeof o.activeEscrows === "number" ? o.activeEscrows : Number(o.activeEscrows) || 0,
    fundedEscrows:
      o.fundedEscrows == null ? undefined : typeof o.fundedEscrows === "number"
        ? o.fundedEscrows
        : Number(o.fundedEscrows) || 0,
    totalEscrows: typeof o.totalEscrows === "number" ? o.totalEscrows : Number(o.totalEscrows) || 0,
  };
}
function parseOobeVolumeDaily(data: unknown): Array<{ day: string; amount: string }> {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  const series = o.series;
  if (!Array.isArray(series)) return [];
  const out: Array<{ day: string; amount: string }> = [];
  for (const row of series) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const day =
      typeof r.day === "string"
        ? r.day
        : typeof r.date === "string"
          ? r.date
          : typeof r.bucketDay === "string"
            ? r.bucketDay
            : null;
    const amount =
      numStr(r.amount) ??
      numStr(r.totalSettledLamports) ??
      numStr(r.settled) ??
      numStr(r.lamports);
    if (day && amount) out.push({ day, amount });
  }
  return out;
}
function parseOobeEscrowAlerts(data: unknown): SapDashboardOobeExplorer["escrowAlerts"] {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const exp = o.expiringEscrows;
  const low = o.lowBalanceEscrows;
  return {
    expiringCount: Array.isArray(exp) ? exp.length : 0,
    lowBalanceCount: Array.isArray(low) ? low.length : 0,
  };
}
function mapOobeExplorerAgentForDashboard(
  row: OobeExplorerAgentRow,
): SapDashboardOobeExplorer["liveAgentsFromApi"][number] {
  const id = row.identity as Record<string, unknown> | undefined;
  const nameRaw = id?.name;
  const name =
    typeof nameRaw === "string" && nameRaw.trim()
      ? nameRaw.trim()
      : `Agent ${row.pda.slice(0, 6)}…`;
  const wallet = typeof id?.wallet === "string" ? id.wallet : null;
  const isActive = typeof id?.isActive === "boolean" ? id.isActive : null;
  const rep = id?.reputationScore;
  let reputationScore: number | null = null;
  if (typeof rep === "number" && Number.isFinite(rep)) reputationScore = Math.round(rep);
  else if (typeof rep === "string") {
    const n = Number.parseFloat(rep);
    if (Number.isFinite(n)) reputationScore = Math.round(n);
  }
  return { pda: row.pda, name, wallet, isActive, reputationScore };
}
function sortOobeLiveAgents(
  rows: SapDashboardOobeExplorer["liveAgentsFromApi"],
): SapDashboardOobeExplorer["liveAgentsFromApi"] {
  return [...rows].sort((a, b) => {
    const dr = (b.reputationScore ?? -1) - (a.reputationScore ?? -1);
    if (dr !== 0) return dr;
    return a.name.localeCompare(b.name);
  });
}
async function loadOobeExplorerDashboardSlice(): Promise<SapDashboardOobeExplorer> {
  const fetchedAt = new Date().toISOString();
  if (skipOobeExplorerCalls()) {
    return {
      available: false,
      fetchedAt,
      globalStatus: null,
      agentsIndexerStale: false,
      metaWarnings: [],
      networkMetrics: null,
      volume: null,
      volumeDailySeries: [],
      escrowAlerts: null,
      liveAgentsFromApi: [],
    };
  }
  const liveAgentsListPromise = listOobeExplorerAgents({ limit: 500 }).then(
    (raw) => ({ liveOk: true as const, liveRows: sortOobeLiveAgents(raw.map(mapOobeExplorerAgentForDashboard)) }),
    (e) => ({
      liveOk: false as const,
      liveRows: [] as SapDashboardOobeExplorer["liveAgentsFromApi"],
      liveErr: Error.isError(e) ? e.message : String(e),
    }),
  );
  try {
    const [statusRes, metricsRaw, volumeRaw, dailyRaw, alertsRaw, livePack] = await Promise.all([
      getOobeExplorerStatus(),
      getOobeNetworkMetrics(),
      getOobeVolume(),
      getOobeVolumeDaily({ days: 14 }),
      getOobeEscrowAlerts(),
      liveAgentsListPromise,
    ]);
    const metaWarnings = Array.isArray((statusRes.meta as { warnings?: unknown } | undefined)?.warnings)
      ? (statusRes.meta as { warnings: unknown[] }).warnings.filter((w): w is string => typeof w === "string")
      : [];
    const liveAgentsFromApi = livePack.liveOk ? livePack.liveRows : [];
    const liveAgentsListError = livePack.liveOk ? undefined : livePack.liveErr;
    return {
      available: true,
      fetchedAt,
      globalStatus: statusRes.data.status ?? null,
      agentsIndexerStale: oobeAgentsCursorStale(statusRes.data),
      metaWarnings,
      networkMetrics: parseOobeNetworkMetrics(metricsRaw),
      volume: parseOobeVolume(volumeRaw),
      volumeDailySeries: parseOobeVolumeDaily(dailyRaw),
      escrowAlerts: parseOobeEscrowAlerts(alertsRaw),
      liveAgentsFromApi,
      liveAgentsListError,
    };
  } catch (e) {
    const livePack = await liveAgentsListPromise;
    const liveAgentsFromApi = livePack.liveOk ? livePack.liveRows : [];
    const liveAgentsListError = livePack.liveOk ? undefined : livePack.liveErr;
    return {
      available: false,
      error: Error.isError(e) ? e.message : String(e),
      fetchedAt,
      globalStatus: null,
      agentsIndexerStale: false,
      metaWarnings: [],
      networkMetrics: null,
      volume: null,
      volumeDailySeries: [],
      escrowAlerts: null,
      liveAgentsFromApi,
      liveAgentsListError,
    };
  }
}
export async function getSapDashboardData(): Promise<SapDashboardPayload> {
  const fetchedAt = new Date().toISOString();
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return {
      totals: {
        sapUniqueAgents: 0,
        sapVerifiedAgents: 0,
        capabilitiesRegistered: 0,
        executionWalletVolumeUsd: 0,
        executionTxCountSum: null,
      },
      recentSyncs: [],
      growth: [],
      oobeExplorer: {
        available: false,
        fetchedAt,
        globalStatus: null,
        agentsIndexerStale: false,
        metaWarnings: [],
        networkMetrics: null,
        volume: null,
        volumeDailySeries: [],
        escrowAlerts: null,
        liveAgentsFromApi: [],
      },
      sapAgentsTable: [],
      sapAgentsTableHasMore: false,
      dashboardSource: "build-stub",
    };
  }
  const [
    sapVerifiedAgents,
    sapIdentitiesForUnique,
    capRows,
    volumeAgg,
    txAgg,
    recentSyncs,
    sapAgentsForTable,
    growthRows,
    oobeExplorer,
  ] = await Promise.all([
    prisma.agent.count({ where: SAP_AGENT_WHERE }),
    prisma.agent.findMany({
      where: SAP_AGENT_WHERE,
      select: { chainId: true, agentId: true, sapAgentPda: true },
    }),
    prisma.$queryRaw<Array<{ sum: bigint }>>`
      SELECT COALESCE(
        SUM(sap_capability_count),
        0
      ) AS sum
      FROM "Agent"
      WHERE sap_verified = true AND "isActive" = true
    `,
    prisma.agent.aggregate({
      where: SAP_AGENT_WHERE,
      _sum: { perfTotalVolumeUsd: true },
    }),
    prisma.agent.aggregate({
      where: SAP_AGENT_WHERE,
      _sum: { perfTxCount: true },
    }),
    prisma.sapSyncLog.findMany({
      orderBy: { syncedAt: "desc" },
      take: 20,
      select: {
        id: true,
        syncedAt: true,
        agentsFound: true,
        agentsUpserted: true,
        durationMs: true,
        errors: true,
      },
    }),
    prisma.agent.findMany({
      where: SAP_AGENT_WHERE,
      orderBy: [{ score: "desc" }, { sapRegisteredAt: "desc" }, { listedAt: "desc" }],
      take: SAP_DASHBOARD_AGENT_TABLE_LIMIT,
      select: {
        chainId: true,
        agentId: true,
        name: true,
        score: true,
        image: true,
        sapAgentPda: true,
        sapOwnerWallet: true,
        sapRegisteredAt: true,
        createdAt: true,
        listedAt: true,
      },
    }),
    prisma.$queryRaw<Array<{ day: Date; cnt: bigint }>>`
      SELECT date_trunc('day', sap_registered_at AT TIME ZONE 'UTC') AS day,
             COUNT(*)::bigint AS cnt
      FROM "Agent"
      WHERE sap_verified = true
        AND sap_registered_at IS NOT NULL
        AND sap_registered_at >= NOW() - INTERVAL '90 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    loadOobeExplorerDashboardSlice(),
  ]);
  const capabilitiesRegistered = numFromBigint(capRows[0]?.sum);
  const vol = volumeAgg._sum.perfTotalVolumeUsd;
  const executionWalletVolumeUsd = vol != null && Number.isFinite(vol) ? vol : 0;
  const tx = txAgg._sum.perfTxCount;
  const executionTxCountSum = tx != null && Number.isFinite(tx) ? Math.round(tx) : null;
  const sapUniqueAgents = countUniqueSapIdentities(sapIdentitiesForUnique);
  const sapAgentsTable = dedupeSapAgentsByIdentity(sapAgentsForTable).map((agent) => ({
    ...agent,
    slug: toAgentUrlSlug(agent.name),
    profilePath: agentPublicPath(agent),
  }));
  return {
    totals: {
      sapUniqueAgents,
      sapVerifiedAgents,
      capabilitiesRegistered,
      executionWalletVolumeUsd,
      executionTxCountSum,
    },
    recentSyncs: recentSyncs.map((r) => ({
      id: r.id,
      syncedAt: r.syncedAt.toISOString(),
      agentsFound: r.agentsFound,
      agentsUpserted: r.agentsUpserted,
      durationMs: r.durationMs,
      errors: r.errors,
    })),
    growth: growthRows.map((g) => ({
      day: g.day.toISOString().slice(0, 10),
      count: numFromBigint(g.cnt),
    })),
    oobeExplorer,
    sapAgentsTable,
    sapAgentsTableHasMore: sapUniqueAgents > sapAgentsTable.length,
  };
}
