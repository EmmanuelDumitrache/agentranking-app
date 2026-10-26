export type PublicMetaplexLaunchRow = {
  id: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  status: string;
  mint: string | null;
  href: string | null;
  continueHref: string;
  custodialWallet: string;
  balanceLamports: number;
  minLamports: number;
  shortfallLamports: number;
  funded: boolean;
  fundingMessage: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicSolanaLaunchRow = {
  id: string;
  chain: "solana";
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  status: string;
  feeSharingStatus: string;
  launchKind: string;
  mint: string | null;
  href: string | null;
  createdAt: string;
  totalDistributedLamports: string;
  creatorShareBps: number;
  arShareBps: number;
};

export type PublicRobinhoodLaunchRow = {
  id: string;
  chain: "robinhood";
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  tokenAddress: string;
  txHash: string;
  href: string;
  createdAt: string;
  creatorFeeBps: number | null;
  poolAddress: string | null;
  positionId: string | null;
  feeSplitterAddress: string | null;
};

export type PublicLaunchesResponse = {
  ok: boolean;
  wallet?: string;
  chain?: "solana" | "evm";
  solana?: PublicSolanaLaunchRow[];
  metaplex?: PublicMetaplexLaunchRow[];
  robinhood?: PublicRobinhoodLaunchRow[];
  error?: string;
};
