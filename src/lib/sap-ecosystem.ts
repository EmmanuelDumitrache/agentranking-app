import { prisma } from "@/lib/db";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import {
  SAP_AGENT_WHERE,
  SAP_VERIFIED_AGENT_WHERE,
  parseSapCapabilities,
  parseSapTiers,
  parseSapStats,
  capabilityKey,
  reputationFromNative,
  txCountFromNative,
  reputationFromStats,
  txCountFromStats,
  volumeFromAgent,
  type SapAgentPublicDto,
  type LeaderboardMode,
  type SapLeaderboardEntry,
} from "@/lib/sap-ecosystem-shared";
import { getOrInsertComputed } from "@/lib/map-upsert";
export type {
  SapCapabilityRow,
  SapStatsJson,
  SapTierRow,
  SapAgentPublicDto,
  X402Status,
  LeaderboardMode,
  SapLeaderboardEntry,
} from "@/lib/sap-ecosystem-shared";
export {
  SAP_AGENT_WHERE,
  SAP_VERIFIED_AGENT_WHERE,
  parseSapCapabilities,
  parseSapTiers,
  parseSapStats,
  capabilityKey,
  minTierPriceNumber,
  reputationFromStats,
  txCountFromStats,
  volumeFromAgent,
  probeX402Endpoint,
} from "@/lib/sap-ecosystem-shared";
const sapPublicSelect = {
  id: true,
  chainId: true,
  agentId: true,
  name: true,
  score: true,
  protocolTrustScore: true,
  sapAgentPda: true,
  sapCapabilities: true,
  sapPricingTiers: true,
  sapProtocols: true,
  sapX402Endpoint: true,
  sapStats: true,
  sapRegisteredAt: true,
  perfTotalVolumeUsd: true,
} as const;
function toDto(row: {
  id: number;
  chainId: number;
  agentId: number;
  name: string;
  score: number;
  protocolTrustScore: number;
  sapAgentPda: string | null;
  sapCapabilities: unknown;
  sapPricingTiers: unknown;
  sapProtocols: string[];
  sapX402Endpoint: string | null;
  sapStats: unknown;
  sapRegisteredAt: Date | null;
  perfTotalVolumeUsd: number | null;
}): SapAgentPublicDto | null {
  const pda = row.sapAgentPda?.trim();
  if (!pda) return null;
  const caps = parseSapCapabilities(row.sapCapabilities);
  const tiers = parseSapTiers(row.sapPricingTiers);
  const stats = parseSapStats(row.sapStats);
  const tx = txCountFromStats(stats);
  const vol = volumeFromAgent(row.perfTotalVolumeUsd, stats);
  return {
    id: row.id,
    chainId: row.chainId,
    agentId: row.agentId,
    name: row.name,
    slug: toAgentUrlSlug(row.name),
    profilePath: agentPublicPath(row),
    sapAgentPda: pda,
    profileScore: row.score,
    protocolTrustScore: row.protocolTrustScore,
    capabilities: caps,
    tiers,
    protocols: [...row.sapProtocols],
    sapStats: stats,
    reputation: reputationFromStats(stats),
    txCountLabel: tx,
    volumeLabel: vol.label,
    perfTotalVolumeUsd: row.perfTotalVolumeUsd,
    sapRegisteredAt: row.sapRegisteredAt?.toISOString() ?? null,
    sapX402Endpoint: row.sapX402Endpoint?.trim() || null,
  };
}
export async function getSapAgentByPda(pda: string): Promise<SapAgentPublicDto | null> {
  const key = pda.trim();
  if (!key) return null;
  const row = await prisma.agent.findFirst({
    where: { ...SAP_AGENT_WHERE, sapAgentPda: key },
    select: sapPublicSelect,
  });
  if (!row) return null;
  return toDto(row);
}
export async function getSapComparePair(
  pdaA: string,
  pdaB: string
): Promise<{ a: SapAgentPublicDto | null; b: SapAgentPublicDto | null }> {
  const [a, b] = await Promise.all([getSapAgentByPda(pdaA), getSapAgentByPda(pdaB)]);
  return { a, b };
}
function entryMetric(e: SapLeaderboardEntry, mode: LeaderboardMode): number {
  switch (mode) {
    case "reputation":
      return e.reputation ?? -1;
    case "volume":
      return e.volumeUsd ?? e.txCountNumeric ?? -1;
    case "capabilities":
      return e.capabilityCount;
    case "protocols":
      return e.protocolCount;
    case "age": {
      const t = e.sapRegisteredAt ? new Date(e.sapRegisteredAt).getTime() : 0;
      return Number.isFinite(t) ? t : Infinity;
    }
    default:
      return 0;
  }
}
export async function getSapLeaderboard(mode: LeaderboardMode, limit = 100): Promise<SapLeaderboardEntry[]> {
  const rows = await prisma.agent.findMany({
    where: SAP_AGENT_WHERE,
    select: {
      chainId: true,
      agentId: true,
      name: true,
      sapAgentPda: true,
      sapProtocols: true,
      sapCapabilityCount: true,
      sapReputationScore: true,
      sapStatsTotalCallsServed: true,
      sapIdentityTotalCallsServed: true,
      sapRegisteredAt: true,
      perfTotalVolumeUsd: true,
      sapCapabilityRows: {
        select: { capabilityId: true, protocol: true },
        orderBy: { ordinal: "asc" },
        take: 4,
      },
    },
  });
  const entries: SapLeaderboardEntry[] = [];
  for (const r of rows) {
    const pda = r.sapAgentPda?.trim();
    if (!pda) continue;
    const rep = reputationFromNative(r.sapReputationScore);
    const txStr = txCountFromNative(r.sapStatsTotalCallsServed, r.sapIdentityTotalCallsServed);
    const txNum = txStr ? Number.parseFloat(txStr) : null;
    const tags = r.sapCapabilityRows
      .map((c) => String(c.capabilityId ?? c.protocol ?? "").trim())
      .filter(Boolean)
      .slice(0, 4);
    entries.push({
      rank: 0,
      chainId: r.chainId,
      agentId: r.agentId,
      name: r.name,
      slug: toAgentUrlSlug(r.name),
      profilePath: agentPublicPath(r),
      sapAgentPda: pda,
      reputation: rep,
      volumeUsd:
        r.perfTotalVolumeUsd != null && Number.isFinite(r.perfTotalVolumeUsd) ? r.perfTotalVolumeUsd : null,
      txCountNumeric: txNum != null && Number.isFinite(txNum) ? txNum : null,
      capabilityCount: r.sapCapabilityCount,
      protocolCount: r.sapProtocols.length,
      sapRegisteredAt: r.sapRegisteredAt?.toISOString() ?? null,
      capabilityTags: tags,
    });
  }
  entries.sort((x, y) => {
    const vx = entryMetric(x, mode);
    const vy = entryMetric(y, mode);
    if (vx === vy) return (y.reputation ?? 0) - (x.reputation ?? 0);
    if (mode === "age") return vx - vy;
    return vy - vx;
  });
  const sliced = entries.slice(0, limit);
  sliced.forEach((e, i) => {
    e.rank = i + 1;
  });
  return sliced;
}
export type CapabilityIndexEntry = {
  capabilityId: string;
  description: string;
  agentCount: number;
  avgPrice: number | null;
  agents: Array<{
    chainId: number;
    agentId: number;
    name: string;
    slug: string;
    profilePath: string;
    sapAgentPda: string;
    protocolTrustScore: number;
    reputation: number | null;
    minPrice: number | null;
    tierLabel: string | null;
  }>;
};
type CapabilityIndexAgentRow = {
  chainId: number;
  agentId: number;
  name: string;
  protocolTrustScore: number;
  sapAgentPda: string | null;
  sapReputationScore: number | null;
  sapMinPricePerCall: unknown;
  sapPrimaryTierId: string | null;
  sapCapabilityRows: Array<{
    capabilityKey: string;
    capabilityId: string;
    protocol: string;
    description: string;
  }>;
};

function groupCapabilityIndex(rows: CapabilityIndexAgentRow[]): CapabilityIndexEntry[] {
  type Acc = {
    descriptions: Map<string, string>;
    agents: CapabilityIndexEntry["agents"];
    prices: number[];
  };
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const pda = r.sapAgentPda?.trim();
    if (!pda) continue;
    const rep = reputationFromNative(r.sapReputationScore);
    const minP = r.sapMinPricePerCall != null ? Number(r.sapMinPricePerCall) : null;
    const tierLabel = r.sapPrimaryTierId;
    for (const c of r.sapCapabilityRows) {
      const key = c.capabilityKey || capabilityKey({ id: c.capabilityId, protocol: c.protocol });
      const desc = String(c.description ?? "").trim() || String(c.protocol ?? "").trim() || key;
      const g = getOrInsertComputed(groups, key, () => ({
        descriptions: new Map(),
        agents: [],
        prices: [],
      }));
      if (!g.descriptions.has(key) && desc) g.descriptions.set(key, desc);
      g.agents.push({
        chainId: r.chainId,
        agentId: r.agentId,
        name: r.name,
        slug: toAgentUrlSlug(r.name),
        profilePath: agentPublicPath(r),
        sapAgentPda: pda,
        protocolTrustScore: r.protocolTrustScore,
        reputation: rep,
        minPrice: minP != null && Number.isFinite(minP) ? minP : null,
        tierLabel: tierLabel ? String(tierLabel) : null,
      });
      if (minP != null && Number.isFinite(minP)) g.prices.push(minP);
    }
  }
  const out: CapabilityIndexEntry[] = [];
  for (const [capabilityId, g] of groups) {
    const description = g.descriptions.get(capabilityId) ?? capabilityId;
    const avg = g.prices.length > 0 ? g.prices.reduce((s, x) => s + x, 0) / g.prices.length : null;
    g.agents.sort((a, b) => (b.reputation ?? -1) - (a.reputation ?? -1));
    out.push({
      capabilityId,
      description,
      agentCount: g.agents.length,
      avgPrice: avg,
      agents: g.agents,
    });
  }
  out.sort((a, b) => b.agentCount - a.agentCount || a.capabilityId.localeCompare(b.capabilityId));
  return out;
}

const CAPABILITY_INDEX_SELECT = {
  chainId: true,
  agentId: true,
  name: true,
  protocolTrustScore: true,
  sapAgentPda: true,
  sapReputationScore: true,
  sapMinPricePerCall: true,
  sapPrimaryTierId: true,
  sapCapabilityRows: {
    select: { capabilityKey: true, capabilityId: true, protocol: true, description: true },
    orderBy: { ordinal: "asc" as const },
  },
} as const;

export async function getSapCapabilityIndex(): Promise<CapabilityIndexEntry[]> {
  const rows = await prisma.agent.findMany({
    where: SAP_AGENT_WHERE,
    select: CAPABILITY_INDEX_SELECT,
  });
  return groupCapabilityIndex(rows as unknown as CapabilityIndexAgentRow[]);
}
/** Slugs for `generateStaticParams` / sitemap; skip DB during production build phase (see sitemap-chunks). */
export async function getSapCapabilityStaticSlugs(): Promise<{ capabilityId: string }[]> {
  if (process.env.NEXT_PHASE === "phase-production-build") return [];
  const idx = await getSapCapabilityIndex();
  return idx.map((c) => ({ capabilityId: c.capabilityId }));
}
export async function getSapCapabilityIndexEntry(
  capabilityIdRaw: string,
): Promise<CapabilityIndexEntry | null> {
  const decoded = decodeURIComponent(capabilityIdRaw);
  const rows = await prisma.agent.findMany({
    where: {
      ...SAP_AGENT_WHERE,
      sapCapabilityRows: { some: { capabilityKey: decoded } },
    },
    select: {
      chainId: true,
      agentId: true,
      name: true,
      protocolTrustScore: true,
      sapAgentPda: true,
      sapReputationScore: true,
      sapMinPricePerCall: true,
      sapPrimaryTierId: true,
      sapCapabilityRows: {
        where: { capabilityKey: decoded },
        select: { capabilityKey: true, capabilityId: true, protocol: true, description: true },
        orderBy: { ordinal: "asc" as const },
      },
    },
  });
  const grouped = groupCapabilityIndex(rows as unknown as CapabilityIndexAgentRow[]);
  return grouped.find((c) => c.capabilityId === decoded) ?? null;
}
export async function getSapAgentCount(): Promise<number> {
  return prisma.agent.count({ where: SAP_VERIFIED_AGENT_WHERE });
}
export type PublicSapStatsPayload = {
  totalSapAgents: number;
  activeAgents: number;
  totalCapabilities: number;
  uniqueCapabilityTypes: number;
  totalVolumeUsdc: number;
  topAgentsByReputation: Array<{
    name: string;
    chainId: number;
    agentId: number;
    slug: string;
    profilePath: string;
    sapAgentPda: string;
    reputation: number | null;
    protocolTrustScore: number;
  }>;
  lastSyncedAt: string | null;
  weeklyGrowthPct: number;
};
function numFromBigint(v: bigint | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}
export async function getPublicSapStatsPayload(): Promise<PublicSapStatsPayload> {
  const [
    totalSapAgents,
    newLast7d,
    newPrev7d,
    capSumRow,
    uniqueTypesRow,
    volumeAgg,
    topRows,
    lastLog,
  ] = await Promise.all([
    prisma.agent.count({ where: SAP_AGENT_WHERE }),
    prisma.agent.count({
      where: {
        ...SAP_AGENT_WHERE,
        sapRegisteredAt: { gte: new Date(Date.now() - 7 * 86400000) },
      },
    }),
    prisma.agent.count({
      where: {
        ...SAP_AGENT_WHERE,
        sapRegisteredAt: {
          gte: new Date(Date.now() - 14 * 86400000),
          lt: new Date(Date.now() - 7 * 86400000),
        },
      },
    }),
    prisma.$queryRaw<Array<{ sum: bigint }>>`
      SELECT COALESCE(
        SUM(sap_capability_count),
        0
      ) AS sum
      FROM "Agent"
      WHERE sap_verified = true AND "isActive" = true
    `,
    prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(DISTINCT c.capability_key)::bigint AS c
      FROM agent_sap_capabilities c
      JOIN "Agent" a ON a.id = c.agent_db_id
      WHERE a.sap_verified = true
        AND a."isActive" = true
        AND c.capability_key <> 'unknown'
    `,
    prisma.agent.aggregate({
      where: SAP_AGENT_WHERE,
      _sum: { perfTotalVolumeUsd: true },
    }),
    prisma.agent.findMany({
      where: SAP_AGENT_WHERE,
      orderBy: [{ sapReputationScore: "desc" }, { sapRegisteredAt: "desc" }],
      take: 10,
      select: {
        name: true,
        chainId: true,
        agentId: true,
        sapAgentPda: true,
        sapReputationScore: true,
        protocolTrustScore: true,
      },
    }),
    prisma.sapSyncLog.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
  ]);
  const withRep = topRows
    .map((r) => {
      const pda = r.sapAgentPda?.trim();
      if (!pda) return null;
      const rep = reputationFromNative(r.sapReputationScore);
      return {
        name: r.name,
        chainId: r.chainId,
        agentId: r.agentId,
        slug: toAgentUrlSlug(r.name),
        profilePath: agentPublicPath(r),
        sapAgentPda: pda,
        reputation: rep,
        protocolTrustScore: r.protocolTrustScore,
        repSort: rep ?? -1,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.repSort - a.repSort)
    .slice(0, 10)
    .map(({ repSort: _, ...rest }) => rest);
  const vol = volumeAgg._sum.perfTotalVolumeUsd;
  const totalVolumeUsdc = vol != null && Number.isFinite(vol) ? vol : 0;
  let weeklyGrowthPct = 0;
  if (newPrev7d > 0) {
    weeklyGrowthPct = ((newLast7d - newPrev7d) / newPrev7d) * 100;
  } else if (newLast7d > 0) {
    weeklyGrowthPct = 100;
  }
  const uniqueTypes = numFromBigint(uniqueTypesRow[0]?.c);
  return {
    totalSapAgents,
    activeAgents: totalSapAgents,
    totalCapabilities: numFromBigint(capSumRow[0]?.sum),
    uniqueCapabilityTypes: uniqueTypes,
    totalVolumeUsdc,
    topAgentsByReputation: withRep,
    lastSyncedAt: lastLog?.syncedAt.toISOString() ?? null,
    weeklyGrowthPct: Math.round(weeklyGrowthPct * 100) / 100,
  };
}
