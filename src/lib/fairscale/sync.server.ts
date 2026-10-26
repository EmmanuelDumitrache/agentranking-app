import { prisma } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/async-pool";
import { AGENTRANKING_NATIVE_CHAIN_ID, SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { AGENTRANKING_LISTING_SOURCE } from "@/lib/dashboard/native-agent";
import {
  resolveFairscaleFailureRetryMs,
  resolveFairscaleSyncConcurrency,
  resolveFairscaleSyncLimit,
} from "@/lib/fairscale/config";
import { resolveFairscaleWalletForAgent } from "@/lib/fairscale/eligibility.server";
import { enqueueFairscaleAssessmentBatch } from "@/lib/fairscale/jobs";
export async function runFairscaleSync(): Promise<{ candidates: number; enqueued: number }> {
  const candidates = await prisma.agent.findMany({
    where: {
      isActive: true,
      OR: [
        {
          listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
          chainId: AGENTRANKING_NATIVE_CHAIN_ID,
        },
        { isPremiumVerified: true },
        { isVerified: true },
        { chainId: SOLANA_CHAIN_ID },
        { sapOwnerWallet: { not: null } },
        { agentWalletId: { not: null } },
      ],
    },
    orderBy: [{ scorePopularity: "desc" }, { lastActiveAt: "desc" }],
    take: resolveFairscaleSyncLimit(),
    select: {
      id: true,
      fairscaleAssessment: {
        select: {
          expiresAt: true,
          lastAttemptAt: true,
          lastError: true,
          status: true,
          walletAddress: true,
        },
      },
    },
  });
  const now = Date.now();
  const results = await mapWithConcurrency(
    candidates,
    resolveFairscaleSyncConcurrency(),
    async (candidate) => {
      const resolution = await resolveFairscaleWalletForAgent(candidate.id);
      if (resolution.status !== "pending" || !resolution.walletAddress) return null;
      const assessment = candidate.fairscaleAssessment;
      const sameWallet = assessment?.walletAddress === resolution.walletAddress;
      const failedAttempt = Boolean(
        assessment
        && (assessment.status !== "scored" || assessment.lastError),
      );
      const retryUntil = failedAttempt && assessment?.lastAttemptAt
        ? assessment.lastAttemptAt.getTime() + resolveFairscaleFailureRetryMs()
        : 0;
      if (
        sameWallet
        && ((assessment?.expiresAt?.getTime() ?? 0) > now || retryUntil > now)
      ) {
        return null;
      }
      return candidate.id;
    },
  );
  const ids = await enqueueFairscaleAssessmentBatch(
    results.filter((agentId): agentId is number => agentId !== null),
  );
  return { candidates: candidates.length, enqueued: ids.length };
}
export async function reportFairscaleEligibility() {
  const agents = await prisma.agent.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const resolutions = await mapWithConcurrency(
    agents,
    resolveFairscaleSyncConcurrency(),
    (agent) => resolveFairscaleWalletForAgent(agent.id),
  );
  let eligibleSolanaAgents = 0;
  let withoutWallets = 0;
  let evmOnlyAgents = 0;
  for (const resolution of resolutions) {
    if (resolution.status === "pending" && resolution.walletAddress) {
      eligibleSolanaAgents += 1;
    } else if (resolution.status === "unsupported_network") {
      evmOnlyAgents += 1;
    } else {
      withoutWallets += 1;
    }
  }
  return {
    eligibleSolanaAgents,
    withoutWallets,
    evmOnlyAgents,
    estimatedSingleRequests: eligibleSolanaAgents,
    estimatedBatchRequests: Math.ceil(eligibleSolanaAgents / 25),
  };
}
