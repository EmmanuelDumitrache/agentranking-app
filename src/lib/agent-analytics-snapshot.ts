import "server-only";
import { prisma } from "@/lib/db";
import {
  loadDashboardAgentOverview,
  loadAgentWalletSolBalanceLamports,
} from "@/lib/dashboard/agent-overview";
import { getSolUsdPrice } from "@/lib/solana-price";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
type FeeDistributionEvent = {
  txSignature: string;
  creatorAmountLamports: bigint;
  arAmountLamports: bigint;
  totalAmountLamports: bigint;
  createdAt: Date;
};
type TransferEvent = {
  id: string;
  signature: string | null;
  token: string;
  amountLamports: bigint;
  fromPublicKey: string;
  toPublicKey: string;
  status: string;
  createdAt: Date;
};
type TimelineEvent = {
  type: string;
  label: string;
  txSignature: string | null;
  createdAt: Date;
};
export type AgentAnalyticsSnapshot = {
  agent: {
    id: number;
    name: string;
    image: string;
    createdAt: Date;
    verificationStatus: string;
    verifiedAt: Date | null;
  };
  wallet: {
    publicKey: string | null;
    solBalanceLamports: number | null;
    estimatedUsd: string | null;
  };
  token: {
    mint: string | null;
    symbol: string | null;
    name: string | null;
    network: string | null;
    launchStatus: string | null;
    lifecycleStatus: string | null;
    feeSharingStatus: string | null;
    creatorShareBps: number;
    arShareBps: number;
    createdAt: Date | null;
  } | null;
  verification: {
    status: string;
    verifiedAt: Date | null;
    txSignature: string | null;
    tokenStatus: string;
    tokenVerifiedAt: Date | null;
  };
  creatorFees: {
    totalDistributedLamports: bigint;
    totalCreatorLamports: bigint;
    totalArLamports: bigint;
    lastDistributionAt: Date | null;
    recentDistributions: FeeDistributionEvent[];
    distributionCount: number;
  };
  walletActivity: {
    recentTransfers: TransferEvent[];
    totalTransfers: number;
  };
  timeline: TimelineEvent[];
  recommendedActions: Array<{ id: string; label: string; description: string; href?: string }>;
};
/* ─── Pure helpers ──────────────────────────────────────────────── */
function computeEstimatedUsd(solLamports: number | null, solPrice: number | null): string | null {
  if (solLamports == null || solPrice == null) return null;
  const sol = solLamports / 1_000_000_000;
  return (sol * solPrice).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
async function buildTimeline(
  agentCreatedAt: Date,
  hasWallet: boolean,
  launch: { id: string } | null,
  verifiedAt: Date | null | undefined,
  txSignature: string | null | undefined,
  tokenVerifiedAt: Date | null | undefined,
  distributions: FeeDistributionEvent[],
): Promise<TimelineEvent[]> {
  const timeline: TimelineEvent[] = [];
  timeline.push({
    type: "agent_created",
    label: "Agent created",
    txSignature: null,
    createdAt: agentCreatedAt,
  });
  if (hasWallet) {
    timeline.push({
      type: "wallet_generated",
      label: "Agent wallet generated",
      txSignature: null,
      createdAt: agentCreatedAt,
    });
  }
  if (launch) {
    const launchEvents = await prisma.agentLaunchEvent.findMany({
      where: { launchId: launch.id },
      orderBy: { createdAt: "asc" },
    });
    for (const evt of launchEvents) {
      timeline.push({
        type: evt.type,
        label: launchEventLabel(evt.type),
        txSignature: evt.txSignature,
        createdAt: evt.createdAt,
      });
    }
  }
  if (verifiedAt) {
    timeline.push({
      type: "agent_verified",
      label: "Agent verified",
      txSignature: txSignature ?? null,
      createdAt: verifiedAt,
    });
  }
  if (tokenVerifiedAt) {
    timeline.push({
      type: "token_verified",
      label: "Token verified",
      txSignature: null,
      createdAt: tokenVerifiedAt,
    });
  }
  for (const dist of distributions) {
    timeline.push({
      type: "fee_distributed",
      label: "Creator fees distributed",
      txSignature: dist.txSignature,
      createdAt: dist.createdAt,
    });
  }
  timeline.sort((a, b) => toSafeDate(b.createdAt).getTime() - toSafeDate(a.createdAt).getTime());
  return timeline;
}
function toSafeDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return new Date(0);
}
function buildRecommendedActions(
  agentDbId: number,
  hasToken: boolean,
  verificationStatus: string,
  solBalance: number | null,
  feeSharingActive: boolean,
  totalCreatorFees: bigint,
  hasDistributions: boolean,
) {
  const actions: Array<{ id: string; label: string; description: string; href?: string }> = [];
  if (!hasToken) {
    actions.push({
      id: "launch_token",
      label: "Launch a token",
      description: "Create an official token linked to this agent.",
      href: `/dashboard/agents/${agentDbId}/launchpad`,
    });
  }
  if (verificationStatus !== "verified") {
    actions.push({
      id: "verify",
      label: "Verify this agent",
      description: "Unlock premium verified status.",
      href: `/dashboard/agents/${agentDbId}/verify`,
    });
  }
  if (solBalance == null || solBalance === 0) {
    actions.push({
      id: "fund_wallet",
      label: "Fund agent wallet",
      description: "Add SOL for launches and verification.",
      href: `/dashboard/agents/${agentDbId}/wallet`,
    });
  }
  if (hasToken && feeSharingActive && totalCreatorFees === BigInt(0)) {
    actions.push({
      id: "share_token",
      label: "Share token page",
      description: "Creator fees accrue when people trade.",
    });
  }
  if (hasToken && hasDistributions) {
    actions.push({
      id: "claim_fees",
      label: "Claim creator fees",
      description: "Distribute accrued fees to the agent wallet.",
      href: `/dashboard/agents/${agentDbId}/wallet`,
    });
  }
  return actions.slice(0, 4);
}
/* ─── Main export ───────────────────────────────────────────────── */
export async function getAgentAnalyticsSnapshot(
  agentDbId: number,
): Promise<AgentAnalyticsSnapshot | null> {
  const overview = await loadDashboardAgentOverview(agentDbId, {
    autoProvisionWallet: false,
  });
  if (!overview) return null;
  const network = getAgentLaunchConfig().network;
  const [launch, transfers, solPrice, solBalance] = await Promise.all([
    prisma.agentLaunch.findFirst({
      where: { network, agentDbId },
      orderBy: { createdAt: "desc" },
      include: {
        distributions: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        _count: { select: { distributions: true } },
      },
    }),
    prisma.custodialWalletTransfer.findMany({
      where: { agentDbId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    getSolUsdPrice(),
    loadAgentWalletSolBalanceLamports(overview.agentWalletPublicKey),
  ]);
  const token = launch ? {
    mint: launch.mint,
    symbol: launch.tokenSymbol,
    name: launch.tokenName,
    network: launch.network,
    launchStatus: launch.launchStatus,
    lifecycleStatus: launch.launchLifecycleStatus ?? null,
    feeSharingStatus: launch.feeSharingStatus,
    creatorShareBps: launch.creatorShareBps,
    arShareBps: launch.arShareBps,
    createdAt: launch.createdAt,
  } : null;
  const recentDistributions: FeeDistributionEvent[] = launch
    ? launch.distributions.map((d) => ({
        txSignature: d.txSignature,
        creatorAmountLamports: d.creatorAmount,
        arAmountLamports: d.arAmount,
        totalAmountLamports: d.totalAmount,
        createdAt: d.createdAt,
      }))
    : [];
  const [timeline, totalTransfers] = await Promise.all([
    buildTimeline(
      overview.agent.createdAt,
      Boolean(overview.agentWalletPublicKey),
      launch ? { id: launch.id } : null,
      overview.agent.arVerifiedAt,
      overview.agent.arVerificationTxSignature,
      launch?.arTokenVerifiedAt,
      recentDistributions,
    ),
    prisma.custodialWalletTransfer.count({ where: { agentDbId } }),
  ]);
  const distributionCount = launch?._count.distributions ?? 0;
  return {
    agent: {
      id: overview.agent.id,
      name: overview.agent.name,
      image: overview.agent.image,
      createdAt: overview.agent.createdAt,
      verificationStatus: overview.agent.arVerificationStatus,
      verifiedAt: overview.agent.arVerifiedAt,
    },
    wallet: {
      publicKey: overview.agentWalletPublicKey,
      solBalanceLamports: solBalance,
      estimatedUsd: computeEstimatedUsd(solBalance, solPrice),
    },
    token,
    verification: {
      status: overview.agent.arVerificationStatus,
      verifiedAt: overview.agent.arVerifiedAt ?? null,
      txSignature: overview.agent.arVerificationTxSignature ?? null,
      tokenStatus: launch?.arTokenVerificationStatus ?? "unverified",
      tokenVerifiedAt: launch?.arTokenVerifiedAt ?? null,
    },
    creatorFees: {
      totalDistributedLamports: launch?.totalFeesDistributedLamports ?? BigInt(0),
      totalCreatorLamports: launch?.totalCreatorFeesLamports ?? BigInt(0),
      totalArLamports: launch?.totalArFeesLamports ?? BigInt(0),
      lastDistributionAt: launch?.lastDistributionAt ?? null,
      recentDistributions,
      distributionCount,
    },
    walletActivity: {
      recentTransfers: transfers.map((t) => ({
        id: t.id,
        signature: t.signature,
        token: t.token,
        amountLamports: t.amountLamports,
        fromPublicKey: t.fromPublicKey,
        toPublicKey: t.toPublicKey,
        status: t.status,
        createdAt: t.createdAt,
      })),
      totalTransfers,
    },
    timeline,
    recommendedActions: buildRecommendedActions(
      agentDbId,
      token !== null,
      overview.agent.arVerificationStatus,
      solBalance,
      launch?.feeSharingStatus === "active",
      launch?.totalCreatorFeesLamports ?? BigInt(0),
      (launch?.totalFeesDistributedLamports ?? BigInt(0)) > BigInt(0),
    ),
  };
}
function launchEventLabel(type: string): string {
  switch (type) {
    case "token_created":
      return "Token launched";
    case "fee_sharing_activated":
      return "Fee sharing activated";
    case "metadata_uploaded":
      return "Metadata uploaded";
    case "fee_distribution":
      return "Creator fees distributed";
    case "launch_created":
      return "Launch initiated";
    case "fee_share_setup":
      return "Fee share setup completed";
    default:
      return type.replaceAll("_", " ");
  }
}
