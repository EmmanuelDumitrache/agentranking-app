import {
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */
export type DesktopTransferParams = {
  recipientPublicKey: string;
  referencePublicKey: string;
  amountAtomic: string;       // atomic units (lamports for SOL, 6-dec for USDC)
  asset: "SOL" | "USDC";
  mint?: string;              // USDC mint address (for USDC transfers)
  decimals: number;           // 9 for SOL, 6 for USDC
  walletPublicKey: PublicKey; // from useWallet().publicKey
  sendTransaction: (tx: Transaction) => Promise<string>; // from useWallet()
};
export type DesktopTransferResult =
  | { ok: true; signature: string }
  | { ok: false; error: string };
/* ------------------------------------------------------------------ */
/*  Build                                                               */
/* ------------------------------------------------------------------ */
/**
 * Builds a Solana Transaction that transfers {@link amountAtomic} units of
 * {@link asset} from {@link walletPublicKey} to {@link recipientPublicKey}
 * and includes {@link referencePublicKey} as a non-signer account key.
 *
 * The reference key is what `validateDepositTransaction()` in `solana-parse.ts`
 * checks for settlement — it appears in the transaction message's accountKeys
 * so the settlement validator can match it.
 */
export async function buildDesktopTransferTransaction(
  params: DesktopTransferParams,
): Promise<Transaction> {
  const { walletPublicKey } = params;
  const tx = new Transaction({ feePayer: walletPublicKey });
  const instruction = await (params.asset === "SOL"
    ? buildSolInstruction(params)
    : buildUsdcInstruction(params));
  // Push the reference public key as a non-signer, read-only account
  // so it appears in transaction.message.accountKeys — required by
  // validateDepositTransaction() in solana-parse.ts.
  instruction.keys.push({
    pubkey: new PublicKey(params.referencePublicKey),
    isSigner: false,
    isWritable: false,
  });
  tx.add(instruction);
  return tx;
}
function buildSolInstruction(
  params: DesktopTransferParams,
) {
  return SystemProgram.transfer({
    fromPubkey: params.walletPublicKey,
    toPubkey: new PublicKey(params.recipientPublicKey),
    lamports: BigInt(params.amountAtomic),
  });
}
async function buildUsdcInstruction(
  params: DesktopTransferParams,
) {
  const mint = new PublicKey(params.mint!);
  const [sourceATA, destATA] = await Promise.all([
    getAssociatedTokenAddress(mint, params.walletPublicKey),
    getAssociatedTokenAddress(mint, new PublicKey(params.recipientPublicKey)),
  ]);
  return createTransferInstruction(
    sourceATA,
    destATA,
    params.walletPublicKey,
    BigInt(params.amountAtomic),
  );
}
/* ------------------------------------------------------------------ */
/*  Execute                                                             */
/* ------------------------------------------------------------------ */
/**
 * Builds the transaction via {@link buildDesktopTransferTransaction} and
 * sends it through the wallet adapter's `sendTransaction`.
 */
export async function executeDesktopTransfer(
  params: DesktopTransferParams,
): Promise<DesktopTransferResult> {
  try {
    const tx = await buildDesktopTransferTransaction(params);
    const signature = await params.sendTransaction(tx);
    return { ok: true, signature };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
/* ------------------------------------------------------------------ */
/*  Sync                                                                */
/* ------------------------------------------------------------------ */
/**
 * POSTs the confirmed signature to the deposit sync endpoint so the server
 * can settle the on-chain deposit.
 */
export async function syncDepositWithSignature(
  depositId: string,
  signature: string,
): Promise<{ ok: boolean; deposit?: unknown; error?: string }> {
  try {
    const res = await fetch(
      `/api/dashboard/credits/llm/deposits/${depositId}/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      },
    );
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    if (!res.ok) {
      const errMsg =
        (json as { error?: string }).error ?? `HTTP ${res.status}`;
      return { ok: false, error: errMsg };
    }
    return {
      ok: true,
      deposit: (json as { deposit?: unknown }).deposit,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}