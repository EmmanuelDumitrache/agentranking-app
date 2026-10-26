import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  mixRecommendedAgents,
  type RecommendedAgentSignals,
} from "@/lib/recommended-agent-ranking";
/** Default ordering for Recommended pool (discoveryScore with AR fallback). */
export const RECOMMENDED_AGENT_POOL_ORDER_BY: Prisma.AgentOrderByWithRelationInput[] = [
  { discoveryScore: "desc" },
  { agentRankScore: "desc" },
  { totalFeedback: "desc" },
  { protocolTrustScore: "desc" },
  { score: "desc" },
];
export function resolveRecommendedPoolOrderBy(
  extra?: Prisma.AgentOrderByWithRelationInput[],
): Prisma.AgentOrderByWithRelationInput[] {
  return extra?.length ? [...RECOMMENDED_AGENT_POOL_ORDER_BY, ...extra] : RECOMMENDED_AGENT_POOL_ORDER_BY;
}
/** Top-N candidates by blend score before `mixRecommendedAgents` balances the final result. */
export async function fetchRecommendedAgentPoolRows<T extends RecommendedAgentSignals>(args: {
  prisma: PrismaClient;
  where: Prisma.AgentWhereInput;
  select: Prisma.AgentSelect;
  poolSize: number;
  extraOrderBy?: Prisma.AgentOrderByWithRelationInput[];
}): Promise<T[]> {
  return args.prisma.agent.findMany({
    where: args.where,
    select: args.select,
    orderBy: resolveRecommendedPoolOrderBy(args.extraOrderBy),
    take: args.poolSize,
  }) as unknown as Promise<T[]>;
}
function dedupeRecommendedPoolRows<T extends RecommendedAgentSignals>(rows: readonly T[]): T[] {
  const seen = new Set<string | number>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
/** Fetch pool + SAP leaders + balance recommendation, review, SAP, and protocol-trust leaders for the final page or featured strip. */
export async function loadRecommendedAgentPool<T extends RecommendedAgentSignals>(args: {
  prisma: PrismaClient;
  where: Prisma.AgentWhereInput;
  select: Prisma.AgentSelect;
  poolSize: number;
  limit: number;
  extraOrderBy?: Prisma.AgentOrderByWithRelationInput[];
  /** When true (default), merge top SAP-verified agents into the candidate pool before mixing. */
  includeSapLeaders?: boolean;
}): Promise<T[]> {
  const includeSap = args.includeSapLeaders !== false;
  const blendPool = await fetchRecommendedAgentPoolRows<T>(args);
  if (!includeSap) {
    return mixRecommendedAgents(blendPool, args.limit);
  }
  const blendIds = blendPool.map((r) => r.id);
  const sapPoolSize = Math.min(16, Math.max(8, Math.floor(args.poolSize / 2)));
  const sapLeaders = await fetchRecommendedAgentPoolRows<T>({
    prisma: args.prisma,
    where: {
      AND: [
        args.where,
        { sapVerified: true },
        ...(blendIds.length > 0 ? [{ id: { notIn: blendIds as number[] } }] : []),
      ],
    },
    select: args.select,
    poolSize: sapPoolSize,
    extraOrderBy: [{ sapRegisteredAt: "desc" }, ...(args.extraOrderBy ?? [])],
  });
  const merged = dedupeRecommendedPoolRows([...blendPool, ...sapLeaders]);
  return mixRecommendedAgents(merged, args.limit);
}
