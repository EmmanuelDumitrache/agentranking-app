import type { SupportedDepositAsset } from "./types";
import { computeMinAmountAtomic } from "./pricing";
export type ParsedDepositAccountKey =
  | string
  | { pubkey: string | { toBase58(): string } };
export interface ParsedDepositTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}
export interface ParsedDepositTransaction {
  transaction: {
    message: {
      accountKeys: ParsedDepositAccountKey[];
    };
  };
  meta: null | {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: ParsedDepositTokenBalance[] | null;
    postTokenBalances?: ParsedDepositTokenBalance[] | null;
  };
}
export type ParsedDepositValidationResult =
  | { ok: true; actualAtomic: bigint }
  | { ok: false; reason: string };
function accountKeyText(key: ParsedDepositAccountKey): string {
  if (typeof key === "string") return key;
  if (typeof key.pubkey === "string") return key.pubkey;
  return key.pubkey.toBase58();
}
function parseAtomic(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
function validateSolTransfer(
  transaction: ParsedDepositTransaction,
  recipient: string,
): ParsedDepositValidationResult {
  const meta = transaction.meta!;
  const keys = transaction.transaction.message.accountKeys.map(accountKeyText);
  const recipientIndex = keys.indexOf(recipient);
  if (recipientIndex < 0) return { ok: false, reason: "wrong_recipient" };
  const pre = meta.preBalances[recipientIndex];
  const post = meta.postBalances[recipientIndex];
  if (!Number.isSafeInteger(pre) || !Number.isSafeInteger(post)) {
    return { ok: false, reason: "invalid_balance_data" };
  }
  const actualAtomic = BigInt(post!) - BigInt(pre!);
  if (actualAtomic <= 0n) return { ok: false, reason: "insufficient_amount" };
  return { ok: true, actualAtomic };
}
function matchingTokenBalances(
  balances: ParsedDepositTokenBalance[] | null | undefined,
  recipient: string,
  mint: string,
): Map<number, bigint> | null {
  const result = new Map<number, bigint>();
  for (const balance of balances ?? []) {
    if (balance.owner !== recipient || balance.mint !== mint) continue;
    if (!Number.isSafeInteger(balance.accountIndex) || balance.accountIndex < 0) return null;
    const amount = parseAtomic(balance.uiTokenAmount.amount);
    if (amount == null) return null;
    result.set(balance.accountIndex, amount);
  }
  return result;
}
function validateSplTransfer(
  transaction: ParsedDepositTransaction,
  recipient: string,
  mint: string | undefined,
): ParsedDepositValidationResult {
  if (!mint) return { ok: false, reason: "missing_mint" };
  const meta = transaction.meta!;
  const pre = matchingTokenBalances(meta.preTokenBalances, recipient, mint);
  const post = matchingTokenBalances(meta.postTokenBalances, recipient, mint);
  if (!pre || !post) return { ok: false, reason: "invalid_balance_data" };
  const indexes = new Set(pre.keys()).union(new Set(post.keys()));
  if (indexes.size === 0) return { ok: false, reason: "wrong_recipient" };
  let actualAtomic = 0n;
  for (const index of indexes) {
    actualAtomic += (post.get(index) ?? 0n) - (pre.get(index) ?? 0n);
  }
  if (actualAtomic <= 0n) return { ok: false, reason: "insufficient_amount" };
  return { ok: true, actualAtomic };
}
/**
 * Validate the exact atomic amount received by a Solana Pay recipient.
 * The unique reference must be present in the transaction's account keys.
 */
export function validateParsedDepositTransfer(
  transaction: ParsedDepositTransaction | null,
  params: {
    recipient: string;
    reference: string;
    expectedAtomic: bigint;
    asset: SupportedDepositAsset;
    mint?: string;
    toleranceBps: number;
  },
): ParsedDepositValidationResult {
  if (!transaction) return { ok: false, reason: "transaction_not_confirmed" };
  if (!transaction.meta || transaction.meta.err != null) {
    return { ok: false, reason: "tx_failed" };
  }
  const keys = transaction.transaction.message.accountKeys.map(accountKeyText);
  if (!keys.includes(params.reference)) return { ok: false, reason: "no_reference" };
  const transfer = params.asset === "SOL"
    ? validateSolTransfer(transaction, params.recipient)
    : validateSplTransfer(transaction, params.recipient, params.mint);
  if (!transfer.ok) return transfer;
  const minimum = computeMinAmountAtomic(params.expectedAtomic, params.toleranceBps);
  if (transfer.actualAtomic < minimum) {
    return { ok: false, reason: "insufficient_amount" };
  }
  return transfer;
}
