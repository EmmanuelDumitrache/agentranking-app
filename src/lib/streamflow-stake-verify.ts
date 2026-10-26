import { Connection, PublicKey } from "@solana/web3.js";
import {
  isAllowlistedStakePool,
  streamflowRpcEndpoint,
} from "@/lib/streamflow-stake-config";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
export type VerifyStakeReportInput = {
  wallet: string;
  txSignature: string;
  poolAddress: string;
  mintAddress: string;
  amountRaw: string;
  durationSec: number;
};
export type VerifyStakeReportResult =
  | {
      ok: true;
      lockEndAt: Date | null;
    }
  | {
      ok: false;
      error: string;
    };
function connection(): Connection {
  return new Connection(streamflowRpcEndpoint(), "confirmed");
}
function signerMatchesWallet(tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>, wallet: string): boolean {
  const keys = tx.transaction.message.getAccountKeys();
  const feePayer = keys.get(0)?.toBase58();
  if (feePayer === wallet) return true;
  const signers = tx.transaction.message.staticAccountKeys
    .slice(0, tx.transaction.signatures.length)
    .map((k) => k.toBase58());
  return signers.includes(wallet);
}
function txMentionsPool(tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>, poolAddress: string): boolean {
  const keys = tx.transaction.message.getAccountKeys();
  for (let i = 0; i < keys.length; i++) {
    if (keys.get(i)?.toBase58() === poolAddress) return true;
  }
  const logs = tx.meta?.logMessages ?? [];
  return logs.some((line) => line.includes(poolAddress));
}
export async function verifyStreamflowStakeReport(
  input: VerifyStakeReportInput,
): Promise<VerifyStakeReportResult> {
  const wallet = normalizeSolanaAddress(input.wallet);
  const txSignature = input.txSignature.trim();
  const poolAddress = input.poolAddress.trim();
  const mintAddress = input.mintAddress.trim();
  if (!wallet) return { ok: false, error: "Invalid wallet address." };
  if (!txSignature) return { ok: false, error: "Transaction signature is required." };
  if (!isAllowlistedStakePool(poolAddress, mintAddress)) {
    return { ok: false, error: "Stake pool or mint is not allowlisted for this deployment." };
  }
  let tx;
  try {
    tx = await connection().getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (e) {
    console.error("[streamflow-stake-verify] getTransaction failed:", e);
    return { ok: false, error: "Could not fetch transaction from Solana RPC." };
  }
  if (!tx) return { ok: false, error: "Transaction not found or not yet confirmed." };
  if (tx.meta?.err) return { ok: false, error: "Transaction failed on-chain." };
  if (!signerMatchesWallet(tx, wallet)) {
    return { ok: false, error: "Transaction signer does not match the reported wallet." };
  }
  if (!txMentionsPool(tx, poolAddress)) {
    return { ok: false, error: "Transaction does not reference the configured stake pool." };
  }
  const durationSec = Math.max(0, input.durationSec);
  const lockEndAt =
    durationSec > 0 ? new Date(Date.now() + durationSec * 1000) : null;
  try {
    void new PublicKey(poolAddress);
    void new PublicKey(mintAddress);
    void new PublicKey(wallet);
  } catch {
    return { ok: false, error: "Invalid pool, mint, or wallet pubkey." };
  }
  return { ok: true, lockEndAt };
}
