

export type ArOpsActivityKind = "buyback" | "burn";
export type ArOpsChainEvent = {
  kind: ArOpsActivityKind;
  signature: string;
  occurredAt: string;
  amountToken: number;
  /** SOL spent on buybacks (matches Solscan “Value (SOL)” when indexed). */
  amountSol: number;
  amountUsd: number;
  counterparty: string;
  source: string;
  solscanUrl: string;
};
export type ArOpsWalletActivityPayload = {
  wallet: string;
  mint: string;
  heliusConfigured: boolean;
  fetchedAt: string;
  totals: {
    buybackCount: number;
    burnCount: number;
    buybackToken: number;
    buybackUsd: number;
    burnedToken: number;
  };
  events: ArOpsChainEvent[];
  cumulativeSeries: Array<{
    date: string;
    buybackUsd: number;
    burnedToken: number;
    buybackUsdCumulative: number;
    burnedTokenCumulative: number;
  }>;
  syncedToDb: number;
  /** Non-fatal hints (e.g. wallet swaps other tokens, not canonical $AR). */
  warnings?: string[];
  error?: string;
};

