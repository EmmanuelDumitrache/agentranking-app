export type CommandCenterLaunchRow = {
  id: string;
  mint: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  agentId: string | null;
  creatorWallet: string | null;
  launchStatus: string;
  feeSharingStatus: string;
  creationTx: string | null;
  feeShareTx: string | null;
  metadataProvider: "mock" | "ipfs" | "unknown";
  metadataUri: string | null;
  passportUri: string | null;
  gatewayMetadataUrl: string | null;
  gatewayPassportUrl: string | null;
  totalFeesDistributedLamports: string;
  totalCreatorFeesLamports: string;
  totalArFeesLamports: string;
  lastDistributionAt: string | null;
  buyEventCount: number;
  sellEventCount: number;
  distributionCount: number;
  distributionAttemptStatus: string | null;
  distributionAttemptMode: string | null;
  distributionAttemptSignature: string | null;
  distributionAttemptError: string | null;
  distributionAttemptUpdatedAt: string | null;
  updatedAt: string;
};
export type AgentLaunchCommandCenterSnapshot = {
  guard: { ok: true } | { ok: false; reason: string };
  featureFlags: {
    network: string;
    feeDistributionEnabled: boolean;
    nodeEnv: string;
  };
  metadataProvider: {
    active: "mock" | "ipfs";
    ipfsConfigured: boolean;
    ipfsGateway: string | null;
  };
  configErrors: string[];
  treasuryWallet: string | null;
  workerWallet: string | null;
  workerBalanceLamports: string | null;
  rpcUrl: string;
  aggregateTotals: {
    totalArFeesLamports: string;
    totalCreatorFeesLamports: string;
    totalFeesDistributedLamports: string;
  };
  launches: CommandCenterLaunchRow[];
};
