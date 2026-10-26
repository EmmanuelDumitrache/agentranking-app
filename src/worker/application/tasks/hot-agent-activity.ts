import { prisma } from "@/lib/db";
import { getAgentActivity } from "@/lib/blockchain/fetch-activity";
import { enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { backgroundJobPausedResult } from "../task-utils";
import { persistAgentActivityJob } from "./agent-activity-persist";
export async function hotAgentActivityJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const hotSet = await prisma.agent.findMany({
    where: { verifiedWallet: { not: "" }, isActive: true },
    orderBy: [{ isVerifiedRevenue: "desc" }, { powerScore: "desc" }],
    take: 20,
    select: { id: true },
  });
  const jobIds = await enqueueApplicationJobs(
    JOB_QUEUES.MAINT_ACTIVITY_AGENT,
    hotSet.map((agent) => ({
      data: { v: 1, id: agent.id },
      singletonKey: String(agent.id),
    })),
  );
  return { ok: true, selected: hotSet.length, enqueued: jobIds.length };
}
export async function hotAgentActivityAgentJob(agentId: number) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, isActive: true, chainId: true, verifiedWallet: true, verifiedWalletChainId: true } });
  if (!agent?.isActive || !agent.verifiedWallet) return { ok: true, skipped: true };
  const walletChainId = agent.verifiedWalletChainId ?? agent.chainId;
  const activity = await getAgentActivity(agent.verifiedWallet, walletChainId);
  if (activity.length === 0) return { ok: true, skipped: true, reason: "no_activity" };
  const fetchedAt = new Date();
  return persistAgentActivityJob({
    v: 1,
    agentId: agent.id,
    walletChainId,
    verifiedWallet: agent.verifiedWallet,
    fetchedAt: fetchedAt.toISOString(),
    activity: activity.map((item) => ({ ...item, timestamp: item.timestamp.toISOString() })),
  });
}
