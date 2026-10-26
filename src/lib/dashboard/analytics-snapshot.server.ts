import "server-only";
import {
  getAgentAnalyticsSnapshot,
  type AgentAnalyticsSnapshot,
} from "@/lib/agent-analytics-snapshot";
import type { DashboardAgentAnalyticsDto } from "@/lib/dashboard/analytics-snapshot-dto";
function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
export function toDashboardAgentAnalyticsDto(
  snapshot: AgentAnalyticsSnapshot,
): DashboardAgentAnalyticsDto {
  return {
    agent: {
      id: snapshot.agent.id,
      name: snapshot.agent.name,
      image: snapshot.agent.image,
      createdAt: snapshot.agent.createdAt.toISOString(),
      verificationStatus: snapshot.agent.verificationStatus,
      verifiedAt: iso(snapshot.agent.verifiedAt),
    },
    wallet: { ...snapshot.wallet },
    token: snapshot.token
      ? {
          ...snapshot.token,
          createdAt: iso(snapshot.token.createdAt),
        }
      : null,
    verification: {
      ...snapshot.verification,
      verifiedAt: iso(snapshot.verification.verifiedAt),
      tokenVerifiedAt: iso(snapshot.verification.tokenVerifiedAt),
    },
    creatorFees: {
      totalDistributedLamports: snapshot.creatorFees.totalDistributedLamports.toString(),
      totalCreatorLamports: snapshot.creatorFees.totalCreatorLamports.toString(),
      totalArLamports: snapshot.creatorFees.totalArLamports.toString(),
      lastDistributionAt: iso(snapshot.creatorFees.lastDistributionAt),
      recentDistributions: snapshot.creatorFees.recentDistributions.map((row) => ({
        txSignature: row.txSignature,
        creatorAmountLamports: row.creatorAmountLamports.toString(),
        arAmountLamports: row.arAmountLamports.toString(),
        totalAmountLamports: row.totalAmountLamports.toString(),
        createdAt: row.createdAt.toISOString(),
      })),
      distributionCount: snapshot.creatorFees.distributionCount,
    },
    walletActivity: {
      recentTransfers: snapshot.walletActivity.recentTransfers.map((row) => ({
        id: row.id,
        signature: row.signature,
        token: row.token,
        amountLamports: row.amountLamports.toString(),
        fromPublicKey: row.fromPublicKey,
        toPublicKey: row.toPublicKey,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
      totalTransfers: snapshot.walletActivity.totalTransfers,
    },
    timeline: snapshot.timeline.map((row) => ({
      type: row.type,
      label: row.label,
      txSignature: row.txSignature,
      createdAt: row.createdAt.toISOString(),
    })),
    recommendedActions: snapshot.recommendedActions.map((action) => ({ ...action })),
  };
}
export async function loadDashboardAgentAnalyticsDto(
  agentDbId: number,
): Promise<DashboardAgentAnalyticsDto | null> {
  const snapshot = await getAgentAnalyticsSnapshot(agentDbId);
  return snapshot ? toDashboardAgentAnalyticsDto(snapshot) : null;
}
