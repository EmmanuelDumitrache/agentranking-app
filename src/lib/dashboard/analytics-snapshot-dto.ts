export type DashboardAgentAnalyticsDto = {
  agent: {
    id: number;
    name: string;
    image: string;
    createdAt: string;
    verificationStatus: string;
    verifiedAt: string | null;
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
    createdAt: string | null;
  } | null;
  verification: {
    status: string;
    verifiedAt: string | null;
    txSignature: string | null;
    tokenStatus: string;
    tokenVerifiedAt: string | null;
  };
  creatorFees: {
    totalDistributedLamports: string;
    totalCreatorLamports: string;
    totalArLamports: string;
    lastDistributionAt: string | null;
    recentDistributions: Array<{
      txSignature: string;
      creatorAmountLamports: string;
      arAmountLamports: string;
      totalAmountLamports: string;
      createdAt: string;
    }>;
    distributionCount: number;
  };
  walletActivity: {
    recentTransfers: Array<{
      id: string;
      signature: string | null;
      token: string;
      amountLamports: string;
      fromPublicKey: string;
      toPublicKey: string;
      status: string;
      createdAt: string;
    }>;
    totalTransfers: number;
  };
  timeline: Array<{
    type: string;
    label: string;
    txSignature: string | null;
    createdAt: string;
  }>;
  recommendedActions: Array<{
    id: string;
    label: string;
    description: string;
    href?: string;
  }>;
};
