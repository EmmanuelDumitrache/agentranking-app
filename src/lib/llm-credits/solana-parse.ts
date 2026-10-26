import { Connection, PublicKey } from "@solana/web3.js";
import type { SupportedDepositAsset } from "./types";
import {
  computeMinAmountAtomic,
  computeMaxAmountAtomic,
} from "./pricing";
import {
  validateParsedDepositTransfer,
  type ParsedDepositTransaction,
} from "./solana-transfer-validation";

type SettlementCommitment = "confirmed" | "finalized";
type DepositTransactionFetcher = (
  signature: string,
  rpcUrl: string,
  commitment: SettlementCommitment,
) => Promise<ParsedDepositTransaction | null>;

async function fetchParsedDepositTransaction(
  signature: string,
  rpcUrl: string,
  commitment: SettlementCommitment,
): Promise<ParsedDepositTransaction | null> {
  const connection = new Connection(rpcUrl, {
    commitment,
    confirmTransactionInitialTimeout: 15_000,
  });
  return connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment,
  }) as Promise<ParsedDepositTransaction | null>;
}

export async function validateDepositTransaction(
  signature: string,
  rpcUrl: string,
  params: {
    recipient: string;
    reference: PublicKey;
    expectedAtomic: bigint;
    asset: SupportedDepositAsset;
    mint?: string;
    toleranceBps: number;
    commitment?: SettlementCommitment;
  },
  fetchTransaction: DepositTransactionFetcher = fetchParsedDepositTransaction,
): Promise<
  | { ok: true; actualAtomic: bigint }
  | { ok: false; reason: string }
> {
  try {
    const transaction = await fetchTransaction(
      signature,
      rpcUrl,
      params.commitment ?? "confirmed",
    );
    return validateParsedDepositTransfer(transaction, {
      recipient: params.recipient,
      reference: params.reference.toBase58(),
      expectedAtomic: params.expectedAtomic,
      asset: params.asset,
      mint: params.mint,
      toleranceBps: params.toleranceBps,
    });
  } catch (error) {
    console.error("[solana-parse] transaction validation failed:", error);
    return { ok: false, reason: "rpc_error" };
  }
}

export { computeMinAmountAtomic, computeMaxAmountAtomic };
