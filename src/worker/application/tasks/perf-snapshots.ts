import { prisma } from "@/lib/db";
import { computeExecutionScore } from "@/lib/agent-score";
import { syncWalletExecutionStats } from "@/lib/onchain/wallet-stats-sync";
import { persistAgentScoresById } from "@/lib/persist-agent-scores";
import { enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { backgroundJobPausedResult } from "../task-utils";
const EXPIRY_BATCH_SIZE = 10_000;
async function expireVerifiedRevenue(now: Date): Promise<number> {
  let expired = 0;
  for (;;) {
    const count = await prisma.$executeRaw`
      WITH candidates AS (
        SELECT ctid
        FROM "Agent"
        WHERE "isVerifiedRevenue" = TRUE
          AND "verifiedRevenueExpiresAt" IS NOT NULL
          AND "verifiedRevenueExpiresAt" < ${now}
        ORDER BY "verifiedRevenueExpiresAt", id
        LIMIT ${EXPIRY_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "Agent" AS agent
      SET "isVerifiedRevenue" = FALSE
      FROM candidates
      WHERE agent.ctid = candidates.ctid
    `;
    expired += count;
    if (count < EXPIRY_BATCH_SIZE) return expired;
  }
}
export async function perfSnapshotsJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const now = new Date();
  const expired = await expireVerifiedRevenue(now);
  const maxAgents = Math.max(1, Math.min(500, Number.parseInt(process.env.PERF_SNAPSHOT_MAX_AGENTS ?? "80", 10) || 80));
  const agents = await prisma.agent.findMany({
    where: { isVerifiedRevenue: true, verifiedWallet: { not: "" }, OR: [{ verifiedRevenueExpiresAt: null }, { verifiedRevenueExpiresAt: { gt: now } }] },
    select: { id: true },
    orderBy: [{ perfLastComputedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: maxAgents,
  });
  const jobIds = await enqueueApplicationJobs(
    JOB_QUEUES.MAINT_PERF_AGENT,
    agents.map((agent) => ({
      data: { v: 1, id: agent.id },
      singletonKey: String(agent.id),
    })),
  );
  return { ok: true, expired, selected: agents.length, enqueued: jobIds.length };
}
export async function perfSnapshotAgentJob(agentId: number) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    // This worker only selects agents with a linked verified wallet, so the
    // metadata fallback in computeExecutionScore can never be consulted. Avoid
    // hydrating every metadata row for each periodic performance job.
    select: { id: true, isVerifiedRevenue: true, verifiedRevenueExpiresAt: true, verifiedWallet: true, verifiedWalletChainId: true, scoreWallet: true, activeWinRate30d: true, nativeVolume30d: true },
  });
  const now = new Date();
  if (!agent || !agent.isVerifiedRevenue || !agent.verifiedWallet || (agent.verifiedRevenueExpiresAt && agent.verifiedRevenueExpiresAt <= now)) return { ok: true, skipped: true };
  const sync = await syncWalletExecutionStats(agent.verifiedWallet, agent.verifiedWalletChainId);
  if (!sync) throw new Error(`No execution stats returned for agent ${agentId}`);
  const perf = sync.perf;
  const executionScore = computeExecutionScore({
    isVerifiedRevenue: true,
    verifiedWallet: agent.verifiedWallet,
    scoreWallet: agent.scoreWallet,
    perfWinRate: perf.winRate,
    perfMonthlyPnlUsd: perf.netPnlUsd,
    perfBurnToEarnRatio: perf.burnToEarnRatio,
    perfTxCount: perf.txCount,
    activeWinRate30d: agent.activeWinRate30d,
    nativeVolume30d: agent.nativeVolume30d,
  });
  await prisma.$transaction([
    prisma.agentPerfSnapshot.create({ data: { agentId, txCount: perf.txCount, profitableTxCount: perf.profitableTxCount, grossProfitUsd: perf.grossProfitUsd, totalFeesUsd: perf.totalFeesUsd, totalGasUsd: perf.totalGasUsd, netPnlUsd: perf.netPnlUsd, volumeUsd: perf.volumeUsd, winRate: perf.winRate, burnToEarnRatio: perf.burnToEarnRatio, avgPnlPercent: perf.avgPnlPercent, rawStatsJson: sync.rawStatsJson } }),
    prisma.agent.update({ where: { id: agentId }, data: { perfWinRate: perf.winRate, perfAvgPnlPercent: perf.avgPnlPercent, perfBurnToEarnRatio: perf.burnToEarnRatio, perfTotalVolumeUsd: perf.volumeUsd, perfMonthlyPnlUsd: perf.netPnlUsd, perfTxCount: perf.txCount, perfProfitableTxCount: perf.profitableTxCount, perfLastComputedAt: now, executionScore } }),
  ]);
  await persistAgentScoresById(prisma, agentId);
  return { ok: true, agentId };
}
