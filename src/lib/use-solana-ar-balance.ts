"use client";

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { formatUnits } from "viem";


import { resolveArTokenDecimals } from "@/lib/ar-token-public";

export type SplBalanceSnapshot = {
  raw: bigint;
  decimals: number;
};
/** Read wallet balance for a single SPL mint (canonical $AR mint only for display). */
export async function readSplBalanceSnapshot(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
): Promise<SplBalanceSnapshot> {
  const mintAccount = await connection.getAccountInfo(mint);
  if (!mintAccount) {
    return { raw: BigInt(0), decimals: resolveArTokenDecimals() };
  }
  const programId = mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  let total = BigInt(0);
  let decimals = resolveArTokenDecimals();
  const seen = new Set<string>();
  try {
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint, programId });
    for (const { pubkey, account } of accounts.value) {
      const id = pubkey.toBase58();
      if (seen.has(id)) continue;
      seen.add(id);
      const parsed = account.data;
      if (!parsed || !("parsed" in parsed)) continue;
      const tokenAmount = parsed.parsed?.info?.tokenAmount;
      if (!tokenAmount?.amount) continue;
      total += BigInt(tokenAmount.amount);
      if (typeof tokenAmount.decimals === "number") {
        decimals = tokenAmount.decimals;
      }
    }
  } catch {
    return { raw: BigInt(0), decimals };
  }
  return { raw: total, decimals };
}
/** Raw SPL amount → plain string for the stake amount input (no thousands commas). */
export function formatSplAmountForInput(raw: bigint, decimals: number): string {
  if (raw <= BigInt(0)) return "";
  const s = formatUnits(raw, decimals);
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}
export function splAmountFromWalletPercent(
  balanceRaw: bigint,
  percent: 25 | 50 | 100,
): bigint {
  if (balanceRaw <= BigInt(0)) return BigInt(0);
  if (percent === 100) return balanceRaw;
  return (balanceRaw * BigInt(percent)) / BigInt(100);
}
/** Human-readable balance (matches Phantom-style rounding for large holdings). */
export function formatSplBalanceUi(raw: bigint, decimals: number): string {
  const n = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    if (millions >= 100) return `${Math.round(millions)}M`;
    const rounded = Math.round(millions * 100) / 100;
    return `${rounded}M`;
  }
  if (n >= 10_000) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
