import { prisma } from "@/lib/db";
import { matchAgentsToJob, type MatchedAgent } from "@/lib/jobs/matching";
import { PUBLIC_PARTNER_JOB_SELECT, toPublicPartnerJob } from "@/lib/jobs/public-job";
import type { PublicPartnerJob } from "@/lib/jobs/types";
import { WORK_READY_PUBLIC_WHERE } from "@/lib/jobs/work-ready";
export type PartnerJobDetailResult = {
  job: PublicPartnerJob;
  matchedAgents: MatchedAgent[];
};
export async function getPartnerJobDetail(id: string): Promise<PartnerJobDetailResult | null> {
  const row = await prisma.partnerJob.findFirst({
    where: { id, isSample: false },
    select: PUBLIC_PARTNER_JOB_SELECT,
  });
  if (!row) return null;
  const partner = await prisma.jobPartnerSource.findUnique({
    where: { source: row.source },
    select: { displayName: true },
  });
  const tags = row.tags;
  const agents = await prisma.agent.findMany({
    where: WORK_READY_PUBLIC_WHERE,
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      description: true,
      image: true,
      isVerified: true,
      isPremiumVerified: true,
      archetype: true,
      sapCapabilities: true,
      agentRankScore: true,
      workReadyStatus: true,
      featuredWorkReady: true,
      workReadyReasons: true,
      verifiedWallet: true,
      sapX402Endpoint: true,
      x402Support: true,
      services: { select: { endpoint: true }, take: 5 },
      mcpOffers: { select: { isPublished: true }, take: 5 },
      paidServices: { select: { isPublished: true, endpointUrl: true }, take: 5 },
      githubConnections: { select: { status: true }, take: 3 },
      verificationSignals: {
        select: { signalType: true, status: true },
        take: 10,
      },
    },
    take: 100,
    orderBy: [{ featuredWorkReady: "desc" }, { agentRankScore: "desc" }],
  });
  const matchedAgents = matchAgentsToJob(
    {
      title: row.title,
      description: row.description,
      category: row.category,
      jobType: row.jobType,
      tags,
    },
    agents,
    6,
  );
  return {
    job: toPublicPartnerJob(row, partner?.displayName ?? row.source),
    matchedAgents,
  };
}
