import { prisma } from "@/lib/db";
export type PerfSnapshotEntry = {
  id: number;
  agentId: number;
  capturedAt: string;
  txCount: number;
  profitableTxCount: number;
  grossProfitUsd: number;
  totalFeesUsd: number;
  totalGasUsd: number;
  netPnlUsd: number;
  volumeUsd: number;
  winRate: number;
  burnToEarnRatio: number;
  avgPnlPercent: number;
};
export async function getPerformanceSnapshots(
  agentDbId: number,
  options?: { since?: Date; limit?: number },
): Promise<PerfSnapshotEntry[]> {
  const limit = options?.limit ?? 100;
  const where: { agentId: number; capturedAt?: { gte: Date } } = {
    agentId: agentDbId,
  };
  if (options?.since) {
    where.capturedAt = { gte: options.since };
  }
  const rows = await prisma.agentPerfSnapshot.findMany({
    where,
    orderBy: { capturedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    capturedAt: r.capturedAt.toISOString(),
    txCount: r.txCount,
    profitableTxCount: r.profitableTxCount,
    grossProfitUsd: r.grossProfitUsd,
    totalFeesUsd: r.totalFeesUsd,
    totalGasUsd: r.totalGasUsd,
    netPnlUsd: r.netPnlUsd,
    volumeUsd: r.volumeUsd,
    winRate: r.winRate,
    burnToEarnRatio: r.burnToEarnRatio,
    avgPnlPercent: r.avgPnlPercent,
  }));
}