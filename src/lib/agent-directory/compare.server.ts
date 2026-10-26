import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadPublicAgentRouteIdentity } from "@/lib/agent-public-route.server";
import { agentPublicPath } from "@/lib/agent-public-url";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import { computeExecutionScore, computeProtocolTrustScoreFromAgentDimensions } from "@/lib/agent-score";
import { redactAgentExecutionForPublicViewer } from "@/lib/agents-api-shared";
import { getDashboardUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
import { computeDashboardUnlocked } from "@/lib/dashboard/access";
import type { CompareAgent, CompareAgentReference } from "@/lib/compare-agent";
const COMPARE_METADATA_KEYS = [
  "registrations",
  "agentWallet",
  "admin_trust_dim_metadata",
  "admin_trust_dim_endpoints",
  "admin_trust_dim_social",
  "admin_trust_dim_compliance",
  "admin_trust_dim_quality",
  "admin_trust_dim_popularity",
  "admin_trust_dim_freshness",
  "admin_trust_dim_verified_revenue",
];
async function canViewCompareExecution(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) return false;
  const resolved = await getDashboardUserProfile(session);
  if (!resolved) return false;
  const profile = await prisma.userProfile.findUnique({
    where: { id: resolved.id },
    select: {
      subscriptionStatus: true,
      subscriptionExpiresAt: true,
      walletAddress: true,
      solanaWallet: true,
    },
  });
  return computeDashboardUnlocked(profile, resolved.id);
}
async function readCompareAgent(
  reference: CompareAgentReference,
  showExecution: boolean,
): Promise<CompareAgent | null> {
  const identity = await loadPublicAgentRouteIdentity(reference.chainId, reference.agentId);
  if (!identity) return null;
  const row = await prisma.agent.findUnique({
    where: { id: identity.id },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      description: true,
      image: true,
      owner: true,
      score: true,
      rank: true,
      totalFeedback: true,
      scoreMetadata: true,
      scoreServices: true,
      scoreQuality: true,
      scorePopularity: true,
      scoreActivity: true,
      scoreWallet: true,
      scoreFreshness: true,
      x402Support: true,
      binanceCompatible: true,
      isVerified: true,
      isPremiumVerified: true,
      isVerifiedRevenue: true,
      agentMode: true,
      agentRankScore: true,
      protocolTrustScore: true,
      executionScore: true,
      verifiedWallet: true,
      perfWinRate: true,
      perfMonthlyPnlUsd: true,
      perfBurnToEarnRatio: true,
      perfTotalVolumeUsd: true,
      activeWinRate30d: true,
      nativeVolume30d: true,
      perfTxCount: true,
      perfProfitableTxCount: true,
      perfLastComputedAt: true,
      chain: { select: { name: true, shortName: true, color: true, icon: true } },
      services: { select: { name: true, endpoint: true }, take: 12 },
      metadata: {
        where: { key: { in: COMPARE_METADATA_KEYS } },
        select: { key: true, value: true },
      },
    },
  });
  if (!row) return null;
  const protocolTrustScore = row.protocolTrustScore > 0
    ? row.protocolTrustScore
    : computeProtocolTrustScoreFromAgentDimensions(row);
  const executionScore = showExecution
    ? Math.max(
        row.executionScore,
        computeExecutionScore({
          isVerifiedRevenue: row.isVerifiedRevenue,
          verifiedWallet: row.verifiedWallet,
          scoreWallet: row.scoreWallet,
          metadata: row.metadata,
          perfWinRate: row.perfWinRate ?? undefined,
          perfMonthlyPnlUsd: row.perfMonthlyPnlUsd ?? undefined,
          perfBurnToEarnRatio: row.perfBurnToEarnRatio ?? undefined,
          perfTxCount: row.perfTxCount ?? undefined,
          activeWinRate30d: row.activeWinRate30d ?? undefined,
          nativeVolume30d: row.nativeVolume30d ?? undefined,
        }),
      )
    : 0;
  const execution = showExecution
    ? {
        verifiedWallet: row.verifiedWallet,
        perfWinRate: row.perfWinRate,
        perfMonthlyPnlUsd: row.perfMonthlyPnlUsd,
        perfBurnToEarnRatio: row.perfBurnToEarnRatio,
        perfTotalVolumeUsd: row.perfTotalVolumeUsd,
        activeWinRate30d: row.activeWinRate30d,
        nativeVolume30d: row.nativeVolume30d,
        perfTxCount: row.perfTxCount,
        perfLastComputedAt: row.perfLastComputedAt?.toISOString() ?? null,
      }
    : redactAgentExecutionForPublicViewer(row.verifiedWallet, "null");
  return {
    id: row.id,
    agentId: row.agentId,
    chainId: row.chainId,
    name: row.name,
    description: row.description,
    image: sanitizeAgentImageUrl(row.image),
    score: row.score,
    rank: row.rank,
    totalFeedback: row.totalFeedback,
    scoreMetadata: row.scoreMetadata,
    scoreServices: row.scoreServices,
    scoreQuality: row.scoreQuality,
    scorePopularity: row.scorePopularity,
    scoreActivity: row.scoreActivity,
    scoreWallet: row.scoreWallet,
    scoreFreshness: row.scoreFreshness,
    x402Support: row.x402Support,
    binanceCompatible: row.binanceCompatible,
    isVerified: row.isVerified,
    isPremiumVerified: row.isPremiumVerified,
    isVerifiedRevenue: row.isVerifiedRevenue,
    profilePath: agentPublicPath({ chainId: row.chainId, agentId: row.agentId, name: row.name }),
    agentMode: row.agentMode,
    agentRankScore: row.agentRankScore,
    protocolTrustScore,
    executionScore,
    owner: row.owner,
    chain: row.chain,
    services: row.services,
    metadata: row.metadata,
    ...execution,
  };
}
export async function readComparePair(
  agentA: CompareAgentReference | null,
  agentB: CompareAgentReference | null,
): Promise<{ agentA: CompareAgent | null; agentB: CompareAgent | null }> {
  if (!agentA && !agentB) return { agentA: null, agentB: null };
  const showExecution = await canViewCompareExecution();
  const [resolvedA, resolvedB] = await Promise.all([
    agentA ? readCompareAgent(agentA, showExecution) : Promise.resolve(null),
    agentB ? readCompareAgent(agentB, showExecution) : Promise.resolve(null),
  ]);
  return { agentA: resolvedA, agentB: resolvedB };
}
