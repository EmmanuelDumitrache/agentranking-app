export type RobinhoodLaunchFormFields = {
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  tokenImageUrl: string;
  tokenImageOriginalUrl?: string | null;
  tokenLogoIpfsCid?: string | null;
  tokenLogoIpfsUri?: string | null;
  tokenLogoGatewayUrl?: string | null;
  onChainLogoUrl?: string | null;
  website: string;
  twitter: string;
  telegram: string;
  discord: string;
  farcaster: string;
  /** Connected creator wallet — must sign the launch tx */
  creatorWallet: string;
  /** Optional linked agent */
  agentDbId?: number | null;
};
export type PreparedRobinhoodLaunchTx = {
  chainId: number;
  to: string;
  data: string;
  value: string;
  /** Connected wallet that must sign — not set server-side on the tx */
  signerWallet: string;
  launchConfigId: number;
  dexId: number;
  launchFeeWei: string;
  /** Human-readable factory launch fee */
  launchFeeEth: string;
  gasSuggestion?: string;
  /** Durable server preparation that must be bound to the confirmed transaction. */
  preparationId: string;
};
export type RobinhoodLaunchRecord = {
  id: string;
  tokenAddress: string;
  creatorWallet: string;
  poolAddress: string | null;
  pairToken: string | null;
  dexFactory: string | null;
  dexId: number | null;
  launchConfigId: number | null;
  positionId: string | null;
  restrictionsEndBlock: string | null;
  initialBuyAmount: string | null;
  txHash: string;
  blockNumber: string;
  blockTimestamp: string;
  chainId: number;
  source: string;
  frontendSourceLabel: string;
  launchedViaAgentRanking: boolean;
  sourceVerified: boolean;
  feeSplitterAddress: string | null;
  creatorFeeBps: number | null;
  /** AgentRanking platform share bps (70/30 → 3000). Named protocolFeeBps in DB. */
  arFeeBps: number | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenDescription: string | null;
  tokenImageUrl: string | null;
  tokenImageOriginalUrl: string | null;
  tokenLogoIpfsCid: string | null;
  tokenLogoIpfsUri: string | null;
  tokenLogoGatewayUrl: string | null;
  onChainLogoUrl: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  farcaster: string | null;
  agentDbId: number | null;
  decimals: number | null;
  totalSupply: string | null;
  onChainPoolFee: number | null;
  maxWalletLimit: string | null;
  maxTxLimit: string | null;
  onChainRestrictionEndBlock: string | null;
  createdAt: string;
  updatedAt: string;
};