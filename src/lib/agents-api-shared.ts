import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPublicSiteUrl } from "@/lib/site-url";
import { isValidArchetypeSlug } from "@/lib/archetype-classifier";
import { computeTrustScore, trustSignalsFromMetadataAndAgent } from "@/lib/trust-score";
import { computeProtocolTrustScoreFromAgentDimensions, computeExecutionScore } from "@/lib/agent-score";
import { attachAgentScoringPayload } from "@/lib/agent-scoring-payload";
import { extendAgentWhereNotBlocked } from "@/lib/agent-blocklist";
import { agentPublicPath, agentPublicUrl, toAgentUrlSlug } from "@/lib/agent-public-url";
export const SKILL_META_KEY_MAP: Record<string, string> = {
  mcp: "mcpTools",
  a2a: "a2aSkills",
  oasf: "oasfSkills",
};
export type AgentsListFilterInput = {
  chain?: string | null;
  search?: string;
  skillsParam?: string;
  x402?: string | null;
  verified?: string | null;
  minScore?: string | null;
  owner?: string;
  archetype?: string | null;
  /** When true, only agents with Verified Revenue (MCP / premium perf path). */
  verifiedRevenueOnly?: boolean;
  /** When true, only agents with a non-empty linked execution wallet. */
  hasLinkedWallet?: boolean;
  /** Filter by autonomous/copilot/hybrid/unknown operating mode. */
  agentMode?: string | null;
};
/** Shared active-agent filter for public APIs and agent discovery. */
export function buildActiveAgentsWhere(input: AgentsListFilterInput): Prisma.AgentWhereInput {
  const where: Prisma.AgentWhereInput = { isActive: true };
  if (input.chain) {
    const cid = Number.parseInt(input.chain, 10);
    if (!Number.isNaN(cid)) where.chainId = cid;
  }
  if (input.search) {
    where.OR = [
      { name: { contains: input.search, mode: "insensitive" } },
      { description: { contains: input.search, mode: "insensitive" } },
      { owner: { contains: input.search, mode: "insensitive" } },
    ];
  }
  if (input.owner) {
    where.owner = { equals: input.owner, mode: "insensitive" };
  }
  if (input.x402 === "true") where.x402Support = true;
  if (input.verified === "true") {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: [{ isVerified: true }, { isPremiumVerified: true }] }];
  }
  if (input.minScore) {
    const n = Number.parseFloat(input.minScore);
    if (!Number.isNaN(n)) where.score = { gte: n };
  }
  const skillsParam = input.skillsParam ?? "";
  if (skillsParam) {
    const requestedSkills = skillsParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const metaKeys = requestedSkills.map((s) => SKILL_META_KEY_MAP[s]).filter(Boolean);
    if (metaKeys.length > 0) {
      const andArr = Array.isArray(where.AND) ? [...where.AND] : [];
      for (const key of metaKeys) {
        andArr.push({ metadata: { some: { key } } });
      }
      where.AND = andArr;
    }
  }
  const arch = input.archetype?.trim() ?? "";
  if (arch && isValidArchetypeSlug(arch)) {
    where.archetype = arch;
  }
  if (input.verifiedRevenueOnly === true) {
    where.isVerifiedRevenue = true;
  }
  if (input.hasLinkedWallet === true) {
    const andArr = Array.isArray(where.AND) ? [...where.AND] : [];
    andArr.push({ verifiedWallet: { not: "" } });
    where.AND = andArr;
  }
  const validModes = ["autonomous", "copilot", "hybrid", "unknown"];
  const mode = input.agentMode?.trim() ?? "";
  if (mode && validModes.includes(mode)) {
    where.agentMode = mode;
  }
  return where;
}
export function agentsListOrderBy(
  sort: string,
): Prisma.AgentOrderByWithRelationInput | Prisma.AgentOrderByWithRelationInput[] {
  const sortMap: Record<
    string,
    Prisma.AgentOrderByWithRelationInput | Prisma.AgentOrderByWithRelationInput[]
  > = {
    agent_rank_desc: { agentRankScore: "desc" },
    agent_rank_asc: { agentRankScore: "asc" },
    profile_desc: { score: "desc" },
    profile_asc: { score: "asc" },
    protocol_trust_desc: { protocolTrustScore: "desc" },
    protocol_trust_asc: { protocolTrustScore: "asc" },
    execution_desc: { executionScore: "desc" },
    execution_asc: { executionScore: "asc" },
    activity_desc: { activityScore: "desc" },
    activity_asc: { activityScore: "asc" },
    created_desc: { createdAt: "desc" },
    created_asc: { createdAt: "asc" },
    listed_desc: { listedAt: "desc" },
    listed_asc: { listedAt: "asc" },
    feedback_desc: { totalFeedback: "desc" },
    verified_first: [
      { isPremiumVerified: "desc" },
      { isVerified: "desc" },
      { agentRankScore: "desc" },
      { totalFeedback: "desc" },
      { id: "asc" },
    ],
    recommended: [
      { discoveryScore: "desc" },
      { agentRankScore: "desc" },
      { totalFeedback: "desc" },
      { id: "asc" },
    ],
  };
  return sortMap[sort] ?? sortMap.agent_rank_desc!;
}
/** Extended public-agent select with verified performance fields. */
export const EXTENDED_AGENT_LIST_SELECT = {
  agentId: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  owner: true,
  score: true,
  rank: true,
  x402Support: true,
  isSmartBatchEnabled: true,
  stars: true,
  totalFeedback: true,
  isVerified: true,
  isPremiumVerified: true,
  binanceCompatible: true,
  isActive: true,
  createdAt: true,
  listedAt: true,
  lastActiveAt: true,
  supportedTrust: true,
  archetype: true,
  archetypeAuto: true,
  agentMode: true,
  protocolTrustScore: true,
  executionScore: true,
  agentRankScore: true,
  activityScore: true,
  // Score dimensions — needed for accurate computeProtocolTrustScoreFromAgentDimensions
  scoreWallet: true,
  scoreMetadata: true,
  scoreServices: true,
  scoreQuality: true,
  scorePopularity: true,
  scoreFreshness: true,
  // Verified performance
  isVerifiedRevenue: true,
  verifiedWallet: true,
  perfWinRate: true,
  perfAvgPnlPercent: true,
  perfBurnToEarnRatio: true,
  perfTotalVolumeUsd: true,
  perfMonthlyPnlUsd: true,
  perfLastComputedAt: true,
  perfTxCount: true,
  perfProfitableTxCount: true,
  activeWinRate30d: true,
  nativeVolume30d: true,
  chain: { select: { name: true, shortName: true, color: true } },
  services: { select: { name: true, endpoint: true, version: true } },
  metadata: { select: { key: true, value: true } },
} satisfies Prisma.AgentSelect;
export type ExtendedAgentListRow = Prisma.AgentGetPayload<{ select: typeof EXTENDED_AGENT_LIST_SELECT }>;
export function formatExtendedAgentRow(a: ExtendedAgentListRow) {
  const base = formatAgentRow(a as unknown as AgentListRow);
  // Compute live execution score from performance fields when the scheduled job has not persisted it yet.
  const liveExecutionScore = computeExecutionScore({
    isVerifiedRevenue: a.isVerifiedRevenue,
    perfWinRate: a.perfWinRate,
    perfMonthlyPnlUsd: a.perfMonthlyPnlUsd,
    perfBurnToEarnRatio: a.perfBurnToEarnRatio,
    activeWinRate30d: a.activeWinRate30d,
    nativeVolume30d: a.nativeVolume30d,
    verifiedWallet: a.verifiedWallet,
    scoreWallet: a.scoreWallet,
    perfTxCount: a.perfTxCount,
    metadata: a.metadata,
  });
  return {
    ...base,
    executionScore: Math.max(base.executionScore, liveExecutionScore),
    isVerifiedRevenue: a.isVerifiedRevenue,
    verifiedWallet: a.verifiedWallet || null,
    /** Indicates that a historical performance snapshot is available for this agent. */
    perfSnapshotAvailable: a.isVerifiedRevenue,
    perfMetrics: a.isVerifiedRevenue
      ? {
          winRate: a.perfWinRate,
          avgPnlPercent: a.perfAvgPnlPercent,
          burnToEarnRatio: a.perfBurnToEarnRatio,
          totalVolumeUsd: a.perfTotalVolumeUsd,
          monthlyPnlUsd: a.perfMonthlyPnlUsd,
          lastComputedAt: a.perfLastComputedAt?.toISOString() ?? null,
          txCount: a.perfTxCount,
          profitableTxCount: a.perfProfitableTxCount,
        }
      : null,
  };
}
export const AGENT_LIST_SELECT = {
  agentId: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  owner: true,
  score: true,
  rank: true,
  x402Support: true,
  isSmartBatchEnabled: true,
  stars: true,
  totalFeedback: true,
  isVerified: true,
  isPremiumVerified: true,
  binanceCompatible: true,
  isActive: true,
  createdAt: true,
  listedAt: true,
  lastActiveAt: true,
  supportedTrust: true,
  archetype: true,
  archetypeAuto: true,
  agentMode: true,
  protocolTrustScore: true,
  executionScore: true,
  agentRankScore: true,
  activityScore: true,
  isVerifiedRevenue: true,
  verifiedWallet: true,
  perfTxCount: true,
  perfWinRate: true,
  perfMonthlyPnlUsd: true,
  perfBurnToEarnRatio: true,
  activeWinRate30d: true,
  nativeVolume30d: true,
  // Score dimensions — needed for accurate computeProtocolTrustScoreFromAgentDimensions
  scoreWallet: true,
  scoreMetadata: true,
  scoreServices: true,
  scoreQuality: true,
  scorePopularity: true,
  scoreFreshness: true,
  chain: { select: { name: true, shortName: true, color: true } },
  services: { select: { name: true, endpoint: true, version: true } },
  metadata: { select: { key: true, value: true } },
} satisfies Prisma.AgentSelect;
export type AgentListRow = Prisma.AgentGetPayload<{ select: typeof AGENT_LIST_SELECT }>;
export function parseJsonArray(metadata: Array<{ key: string; value: string }>, key: string): string[] {
  const entry = metadata.find((m) => m.key === key);
  if (!entry) return [];
  try {
    const arr = JSON.parse(entry.value);
    if (Array.isArray(arr)) return arr.map(String);
  } catch {
    /* ignore */
  }
  return [];
}
export function formatAgentRow(a: AgentListRow) {
  const base = getPublicSiteUrl();
  // Use stored protocolTrustScore when backfilled (> 0); fall back to live computation for freshly-indexed agents.
  const computedProtocolTrustScore = computeProtocolTrustScoreFromAgentDimensions({
    scoreMetadata: a.scoreMetadata,
    scoreServices: a.scoreServices,
    scoreWallet: a.scoreWallet,
    scoreQuality: a.scoreQuality,
    scorePopularity: a.scorePopularity,
    scoreFreshness: a.scoreFreshness,
    x402Support: a.x402Support,
    binanceCompatible: a.binanceCompatible,
    metadata: a.metadata,
    services: a.services,
  });
  const protocolTrustScore = a.protocolTrustScore > 0 ? a.protocolTrustScore : computedProtocolTrustScore;
  const liveExecutionScore = computeExecutionScore({
    isVerifiedRevenue: a.isVerifiedRevenue,
    perfWinRate: a.perfWinRate,
    perfMonthlyPnlUsd: a.perfMonthlyPnlUsd,
    perfBurnToEarnRatio: a.perfBurnToEarnRatio,
    activeWinRate30d: a.activeWinRate30d,
    nativeVolume30d: a.nativeVolume30d,
    verifiedWallet: a.verifiedWallet,
    scoreWallet: a.scoreWallet,
    perfTxCount: a.perfTxCount,
    metadata: a.metadata,
  });
  const executionScore = Math.max(a.executionScore ?? 0, liveExecutionScore);
  const scoring = attachAgentScoringPayload({
    name: a.name,
    description: a.description,
    image: a.image,
    metadata: a.metadata,
    services: a.services.map((s) => ({ name: s.name, endpoint: s.endpoint })),
    scoreWallet: a.scoreWallet,
    x402Support: a.x402Support,
    binanceCompatible: a.binanceCompatible,
    totalFeedback: a.totalFeedback,
    stars: a.stars,
    scoreQuality: a.scoreQuality,
    scoreMetadata: a.scoreMetadata,
    scoreServices: a.scoreServices,
    scoreFreshness: a.scoreFreshness,
    scorePopularity: a.scorePopularity,
    lastActiveAt: a.lastActiveAt,
    isVerified: a.isVerified,
    isPremiumVerified: a.isPremiumVerified,
    isVerifiedRevenue: a.isVerifiedRevenue,
    verifiedWallet: a.verifiedWallet,
    perfWinRate: a.perfWinRate,
    perfMonthlyPnlUsd: a.perfMonthlyPnlUsd,
    perfBurnToEarnRatio: a.perfBurnToEarnRatio,
    perfTxCount: a.perfTxCount,
    activeWinRate30d: a.activeWinRate30d,
    nativeVolume30d: a.nativeVolume30d,
    rank: a.rank,
    score: a.score,
    protocolTrustScore,
    agentRankScore: a.agentRankScore,
    activityScore: a.activityScore,
    executionScore,
  });
  return {
    agentId: a.agentId,
    chainId: a.chainId,
    name: a.name,
    slug: toAgentUrlSlug(a.name),
    profilePath: agentPublicPath(a),
    description: a.description,
    image: a.image,
    owner: a.owner,
    score: a.score,
    rank: a.rank,
    organicRank: a.rank,
    x402Support: a.x402Support,
    isSmartBatchEnabled: a.isSmartBatchEnabled,
    stars: a.stars,
    totalFeedback: a.totalFeedback,
    isVerified: a.isVerified,
    isPremiumVerified: a.isPremiumVerified,
    binanceCompatible: a.binanceCompatible,
    isActive: a.isActive,
    createdAt: a.createdAt,
    listedAt: a.listedAt,
    lastActiveAt: a.lastActiveAt,
    supportedTrust: a.supportedTrust,
    archetype: a.archetype,
    archetypeAuto: a.archetypeAuto,
    agentRankScore: scoring.agentRankScore,
    protocolTrustScore: scoring.protocolTrustScore,
    profileScore: scoring.profileScore,
    reputationScore: scoring.reputationScore,
    activityScore: scoring.activityScore,
    monetizationScore: scoring.monetizationScore,
    rankConfidence: scoring.rankConfidence,
    confidenceSummary: scoring.confidenceSummary,
    scoreBreakdown: scoring.scoreBreakdown,
    scoreVersion: scoring.scoreVersion,
    executionScore,
    chain: a.chain,
    services: a.services,
    capabilities: {
      mcpTools: parseJsonArray(a.metadata, "mcpTools"),
      a2aSkills: parseJsonArray(a.metadata, "a2aSkills"),
      oasfSkills: parseJsonArray(a.metadata, "oasfSkills"),
      oasfDomains: parseJsonArray(a.metadata, "oasfDomains"),
    },
    profileUrl: agentPublicUrl(base, a),
  };
}
export async function queryAgentsListShared(args: {
  where: Prisma.AgentWhereInput;
  orderBy:
    | Prisma.AgentOrderByWithRelationInput
    | Prisma.AgentOrderByWithRelationInput[];
  skip: number;
  take: number;
}): Promise<{ rows: AgentListRow[]; total: number }> {
  const where = await extendAgentWhereNotBlocked(args.where);
  const rows = await prisma.agent.findMany({
    where,
    orderBy: args.orderBy,
    skip: args.skip,
    take: args.take,
    select: AGENT_LIST_SELECT,
  });
  const total = await prisma.agent.count({ where });
  return { rows, total };
}
/** Max rows loaded into memory when sorting by trust (not a DB column). */
export const PROTOCOL_TRUST_SORT_MAX_POOL = 2500;
export type ProtocolTrustSortMeta = {
  capped: boolean;
  fullMatchCount: number;
  poolSize: number;
};
/**
 * Sort active agents by computed protocolTrustScore (metadata + verification).
 * Loads up to `maxPool` rows (by score tie-break) then sorts in memory — see `protocolTrustSort` in API meta when capped.
 */
export async function queryAgentsListProtocolTrustSort(args: {
  where: Prisma.AgentWhereInput;
  direction: "desc" | "asc";
  page: number;
  perPage: number;
  maxPool?: number;
}): Promise<{ rows: AgentListRow[]; total: number; protocolTrustSort: ProtocolTrustSortMeta }> {
  const maxPool = args.maxPool ?? PROTOCOL_TRUST_SORT_MAX_POOL;
  const where = await extendAgentWhereNotBlocked(args.where);
  const fullCount = await prisma.agent.count({ where });
  const poolSize = Math.min(maxPool, fullCount);
  const pool = await prisma.agent.findMany({
    where,
    select: AGENT_LIST_SELECT,
    orderBy: [{ score: "desc" }, { totalFeedback: "desc" }, { lastActiveAt: "desc" }],
    take: poolSize,
  });
  const scored = pool.map((row) => ({
    row,
    trust: computeTrustScore(trustSignalsFromMetadataAndAgent(row)),
  }));
  scored.sort((a, b) => {
    const t = args.direction === "desc" ? b.trust - a.trust : a.trust - b.trust;
    if (t !== 0) return t;
    const s = b.row.score - a.row.score;
    if (s !== 0) return s;
    return b.row.totalFeedback - a.row.totalFeedback;
  });
  const ordered = scored.map((s) => s.row);
  const skip = (args.page - 1) * args.perPage;
  const slice = ordered.slice(skip, skip + args.perPage);
  return {
    rows: slice,
    total: ordered.length,
    protocolTrustSort: {
      capped: fullCount > maxPool,
      fullMatchCount: fullCount,
      poolSize: ordered.length,
    },
  };
}
/** Truncate a long execution wallet for public / non–Pro surfaces (matches compare list UX). */
export function truncateVerifiedWalletForPublicDisplay(
  verifiedWallet: string | null | undefined
): string {
  const vw = (verifiedWallet ?? "").trim();
  if (vw.length > 10) return `${vw.slice(0, 6)}…${vw.slice(-4)}`;
  return vw;
}
type NullOrUndefined = null | undefined;
/**
 * Strip execution-wallet proof and perf metrics for viewers without Agent Dashboard Pro
 * (compare mode, agent detail JSON, etc.).
 * Use `"null"` for Prisma-shaped payloads; `"undefined"` for list APIs so fields drop from JSON.
 */
export function redactAgentExecutionForPublicViewer(
  verifiedWallet: string | null | undefined,
  emptyPerf: "null" | "undefined"
): {
  verifiedWallet: string;
  perfWinRate: NullOrUndefined;
  perfMonthlyPnlUsd: NullOrUndefined;
  perfTotalVolumeUsd: NullOrUndefined;
  perfAvgPnlPercent: NullOrUndefined;
  perfBurnToEarnRatio: NullOrUndefined;
  perfLastComputedAt: NullOrUndefined;
  perfProfitableTxCount: NullOrUndefined;
  perfTxCount: NullOrUndefined;
  activeWinRate30d: NullOrUndefined;
  nativeVolume30d: NullOrUndefined;
} {
  const e: NullOrUndefined = emptyPerf === "null" ? null : undefined;
  return {
    verifiedWallet: truncateVerifiedWalletForPublicDisplay(verifiedWallet),
    perfWinRate: e,
    perfMonthlyPnlUsd: e,
    perfTotalVolumeUsd: e,
    perfAvgPnlPercent: e,
    perfBurnToEarnRatio: e,
    perfLastComputedAt: e,
    perfProfitableTxCount: e,
    perfTxCount: e,
    activeWinRate30d: e,
    nativeVolume30d: e,
  };
}
