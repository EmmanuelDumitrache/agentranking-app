export type SupportedDepositAsset = "SOL" | "USDC";
export type DepositConfig = {
  depositAsset: SupportedDepositAsset;
  minUsdCents: number;
  treasuryWallet?: string;
  quoteTtlSeconds: number;
  settlementCommitment: "confirmed" | "finalized";
  solOverpayToleranceBps: number;
  usdcOverpayToleranceBps: number;
  costMarginBps: number;
};
export type SettlementResult =
  | {
      ok: true;
      signature: string;
      creditedCents: number;
      ledgerId: string;
    }
  | {
      ok: false;
      reason: string;
    };
export type DepositListItem = {
  id: string;
  status: string;
  asset: SupportedDepositAsset;
  quotedCents: number;
  expectedAmountAtomic: string;
  displayAmount: string;
  recipientPublicKey: string;
  referencePublicKey: string;
  paymentUrl: string;
  quoteExpiresAt: string;
  createdAt?: string;
  settledAt?: string;
  signature?: string;
  creditedCents?: number;
  failureReason?: string;
};
