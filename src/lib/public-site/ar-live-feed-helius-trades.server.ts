import "server-only";
import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { getSolUsdPrice } from "@/lib/solana-price";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const HELIUS_TX_LIMIT = 8;

const HeliusTokenTransferSchema = z.object({
  mint: z.string().optional(),
  tokenAmount: z.number().optional(),
  fromUserAccount: z.string().optional(),
  toUserAccount: z.string().optional(),
});

export type HeliusTokenTransfer = z.infer<typeof HeliusTokenTransferSchema>;

const HeliusParsedTxSchema = z.object({
  signature: z.string().optional(),
  timestamp: z.number().optional(),
  type: z.string().optional(),
  feePayer: z.string().optional(),
  tokenTransfers: z.array(HeliusTokenTransferSchema).optional(),
});

type HeliusParsedTx = z.infer<typeof HeliusParsedTxSchema>;

const HeliusParsedTxListSchema = z.array(HeliusParsedTxSchema);

export type ArListedBuyTrade = {
  signature: string;
  mint: string;
  solAmount: number;
  tokenAmount: number;
  usdAmount: number;
  occurredAt: string;
};
/** Shared Valkey-backed SOL/USD snapshot for live-feed valuation. */
export function getSolPriceUsd(): Promise<number | null> {
  return getSolUsdPrice();
}
/**
 * Recent AR-mint buys from Helius enhanced transactions (Pump AMM / DEX swaps).
 * Returns buys only — sells are ignored for the lift feed.
 */
export async function fetchRecentArMintBuys(input: {
  mint: string;
  minUsd: number;
  solPriceUsd: number;
}): Promise<ArListedBuyTrade[]> {
  const apiKey = process.env.HELIUS_API_KEY?.trim();
  const mint = input.mint.trim();
  if (!apiKey || !mint) return [];
  try {
    const url =
      `https://api.helius.xyz/v0/addresses/${encodeURIComponent(mint)}/transactions` +
      `?api-key=${encodeURIComponent(apiKey)}&limit=${HELIUS_TX_LIMIT}&type=SWAP`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return [];
    const rows = await parseBoundedJsonBody(
      response,
      HeliusParsedTxListSchema,
      2 * 1024 * 1024,
    );
    if (!Array.isArray(rows)) return [];
    const out: ArListedBuyTrade[] = [];
    for (const tx of rows) {
      const parsed = parseBuyFromHeliusTx(tx, mint, input.solPriceUsd);
      if (!parsed) continue;
      if (parsed.usdAmount < input.minUsd) continue;
      out.push(parsed);
    }
    return out;
  } catch {
    return [];
  }
}
function parseBuyFromHeliusTx(
  tx: HeliusParsedTx,
  mint: string,
  solPriceUsd: number,
): ArListedBuyTrade | null {
  const signature = tx.signature?.trim();
  const feePayer = tx.feePayer?.trim();
  if (!signature || !feePayer) return null;
  const transfers = tx.tokenTransfers ?? [];
  let solSpent = 0;
  let tokensBought = 0;
  for (const transfer of transfers) {
    const amount = typeof transfer.tokenAmount === "number" ? transfer.tokenAmount : 0;
    if (!(amount > 0)) continue;
    if (
      transfer.mint === WSOL_MINT &&
      transfer.fromUserAccount === feePayer
    ) {
      solSpent += amount;
    }
    if (
      transfer.mint === mint &&
      transfer.toUserAccount === feePayer
    ) {
      tokensBought += amount;
    }
  }
  // Buy = payer spent SOL and received the AR mint.
  if (!(solSpent > 0) || !(tokensBought > 0)) return null;
  const usdAmount = solSpent * solPriceUsd;
  const occurredAt =
    typeof tx.timestamp === "number" && Number.isFinite(tx.timestamp)
      ? new Date(tx.timestamp * 1_000).toISOString()
      : new Date().toISOString();
  return {
    signature,
    mint,
    solAmount: solSpent,
    tokenAmount: tokensBought,
    usdAmount,
    occurredAt,
  };
}
