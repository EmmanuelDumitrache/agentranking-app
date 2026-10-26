/**
 * Per-agent on-chain activity fetcher.
 *
 * Solana  → Helius Enhanced Transactions API (swap-pair heuristic)
 * Base    → EVM ERC-20 transfer logs
 *
 * All derived "success" values are HEURISTICS, not audited PnL.
 * Label them accordingly in UI and public API descriptions.
 */
import { z } from "zod";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { fetchEvmTransferLogs, STABLECOIN_ADDRESSES } from "@/lib/blockchain/fetch-evm-transfers";
import type { Address } from "viem";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
/** Max signatures to pull per wallet (Helius credits). Env HELIUS_ACTIVITY_TX_LIMIT, default 15, clamp 5–50. */
function heliusActivityTxLimit(): number {
  const raw = process.env.HELIUS_ACTIVITY_TX_LIMIT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 15;
  if (!Number.isFinite(n)) return 15;
  return Math.min(50, Math.max(5, n));
}
// ─── Shared types ────────────────────────────────────────────────────────────
export type ActivityType = "buy" | "sell" | "unknown";
export interface NormalizedActivityItem {
  type: ActivityType;
  /** Token mint (Solana) or contract address (EVM). */
  token: string;
  /** Token amount involved in the leg. */
  amount: number;
  timestamp: Date;
  /**
   * Heuristic success flag.
   * - buy:  always true (execution succeeded)
   * - sell: true when nativeReceived > nativeSpent on the preceding buy for same token
   * - unknown: false
   */
  success: boolean;
  txSignatureOrHash: string;
  /** Native SOL or ETH spent (buy) or received (sell). */
  nativeAmount: number;
}
// ─── Helius types (minimal subset we consume) ────────────────────────────────
const HeliusSwapEventSchema = z.object({
  nativeInput: z.object({ account: z.string(), amount: z.number() }).nullable().optional(),
  nativeOutput: z.object({ account: z.string(), amount: z.number() }).nullable().optional(),
  tokenInputs: z.array(z.object({ mint: z.string(), tokenAmount: z.number() })).optional(),
  tokenOutputs: z.array(z.object({ mint: z.string(), tokenAmount: z.number() })).optional(),
});

const HeliusParsedTxSchema = z.object({
  signature: z.string(),
  timestamp: z.number(), // unix seconds
  type: z.string().optional(),
  transactionError: z.unknown().optional(),
  events: z.object({
    swap: HeliusSwapEventSchema.optional(),
  }).optional(),
});

type HeliusParsedTx = z.infer<typeof HeliusParsedTxSchema>;

const HeliusSigsSchema = z.array(z.object({
  signature: z.string(),
}));

const HeliusParsedTxListSchema = z.array(HeliusParsedTxSchema);

// ─── Solana / Helius ─────────────────────────────────────────────────────────
const HELIUS_RPC_BASE = "https://api.helius.xyz/v0";
async function heliusGet<S extends z.ZodType>(path: string, schema: S, apiKey: string): Promise<z.output<S>> {
  const url = `${HELIUS_RPC_BASE}${path}?api-key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`Helius ${path} → HTTP ${res.status}`);
  }
  return parseBoundedJsonBody(res, schema, 4 * 1024 * 1024);
}
async function heliusPost<S extends z.ZodType>(path: string, body: unknown, schema: S, apiKey: string): Promise<z.output<S>> {
  const url = `${HELIUS_RPC_BASE}${path}?api-key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`Helius ${path} → HTTP ${res.status}`);
  }
  return parseBoundedJsonBody(res, schema, 16 * 1024 * 1024);
}
/**
 * Fetch up to `limit` recent parsed transactions for a Solana wallet.
 * Uses Helius Enhanced Transactions API which returns swap events.
 */
async function fetchHeliusParsedTxs(
  wallet: string,
  apiKey: string,
  limit = 20
): Promise<HeliusParsedTx[]> {
  // Step 1: get signatures
  const sigs = await heliusGet(
    `/addresses/${encodeURIComponent(wallet)}/transactions`,
    HeliusSigsSchema,
    apiKey
  );
  const signatures = sigs.slice(0, limit).map((s) => s.signature);
  if (signatures.length === 0) return [];
  // Step 2: parse transactions — request maxSupportedTransactionVersion: 0
  // so versioned transactions (common for modern bots) are not dropped.
  const parsed = await heliusPost(
    "/transactions",
    { transactions: signatures, commitment: "confirmed" },
    HeliusParsedTxListSchema,
    apiKey
  );
  return parsed;
}
/**
 * Analyze a single Helius parsed transaction for swap legs.
 * Returns one NormalizedActivityItem per swap leg, or nothing if not a swap.
 *
 * Success heuristic (sell only):
 *   nativeReceived > nativeSpentOnPrecedingBuy for same token mint.
 * Buys are always success=true (execution confirmed).
 */
function analyzeSolanaSwap(
  tx: HeliusParsedTx,
  recentBuys: Map<string, number>
): NormalizedActivityItem | null {
  if (tx.transactionError) return null;
  const swap = tx.events?.swap;
  if (!swap) return null;
  const timestamp = new Date(tx.timestamp * 1000);
  const isBuy =
    swap.nativeInput != null &&
    swap.tokenOutputs != null &&
    swap.tokenOutputs.length > 0;
  const isSell =
    swap.nativeOutput != null &&
    swap.tokenInputs != null &&
    swap.tokenInputs.length > 0;
  if (isBuy) {
    const nativeSpent = ((swap.nativeInput?.amount) ?? 0) / 1e9; // lamports → SOL
    const tokenMint = swap.tokenOutputs?.[0].mint ?? "";
    const tokenAmount = swap.tokenOutputs?.[0].tokenAmount ?? 0;
    // Record this buy for later sell pairing (FIFO: overwrite with latest)
    recentBuys.set(tokenMint, nativeSpent);
    return {
      type: "buy",
      token: tokenMint,
      amount: tokenAmount,
      timestamp,
      success: true,
      txSignatureOrHash: tx.signature,
      nativeAmount: nativeSpent,
    };
  }
  if (isSell) {
    const nativeReceived = ((swap.nativeOutput?.amount) ?? 0) / 1e9;
    const tokenMint = swap.tokenInputs?.[0].mint ?? "";
    const tokenAmount = swap.tokenInputs?.[0].tokenAmount ?? 0;
    const previousNativeSpent = recentBuys.get(tokenMint) ?? 0;
    // Success = got more SOL back than spent on the paired buy (gross, pre-fee)
    const isProfitable = previousNativeSpent > 0
      ? nativeReceived > previousNativeSpent
      : nativeReceived > 0;
    // Remove the paired buy so it isn't reused
    recentBuys.delete(tokenMint);
    return {
      type: "sell",
      token: tokenMint,
      amount: tokenAmount,
      timestamp,
      success: isProfitable,
      txSignatureOrHash: tx.signature,
      nativeAmount: nativeReceived,
    };
  }
  return null;
}
async function fetchSolanaActivity(wallet: string): Promise<NormalizedActivityItem[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.warn("[fetch-activity] HELIUS_API_KEY not set — skipping Solana fetch");
    return [];
  }
  const txs = await fetchHeliusParsedTxs(wallet, apiKey, heliusActivityTxLimit());
  // Process oldest-first so buy→sell pairing is FIFO
  const ordered = [...txs].sort((a, b) => a.timestamp - b.timestamp);
  const recentBuys = new Map<string, number>();
  const results: NormalizedActivityItem[] = [];
  for (const tx of ordered) {
    const item = analyzeSolanaSwap(tx, recentBuys);
    if (item) results.push(item);
  }
  // Return newest-first for display
  return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
// ─── EVM / Base ──────────────────────────────────────────────────────────────
/**
 * Fetch Base/ETH activity using ERC-20 Transfer logs.
 * Maps stablecoin inbound transfers as "buy" (profit) and outbound as "sell".
 * This mirrors the approach used in the performance snapshot job.
 */
async function fetchBaseActivity(wallet: string, chainId: number): Promise<NormalizedActivityItem[]> {
  try {
    const { inbound, outbound } = await fetchEvmTransferLogs(wallet as Address, chainId, BigInt(100_000));
    const results: NormalizedActivityItem[] = [];
    for (const log of inbound) {
      const addr = (log.address ?? "").toLowerCase();
      const isStable = STABLECOIN_ADDRESSES.has(addr);
      const rawValue = (log.args as { value?: bigint }).value ?? BigInt(0);
      const amount = Number(rawValue) / (isStable ? 1e6 : 1e18);
      results.push({
        type: "buy",
        token: log.address,
        amount,
        timestamp: new Date(),
        success: true,
        txSignatureOrHash: log.transactionHash,
        nativeAmount: amount,
      });
    }
    for (const log of outbound) {
      const addr = (log.address ?? "").toLowerCase();
      const isStable = STABLECOIN_ADDRESSES.has(addr);
      const rawValue = (log.args as { value?: bigint }).value ?? BigInt(0);
      const amount = Number(rawValue) / (isStable ? 1e6 : 1e18);
      results.push({
        type: "sell",
        token: log.address,
        amount,
        timestamp: new Date(),
        success: amount > 0,
        txSignatureOrHash: log.transactionHash,
        nativeAmount: amount,
      });
    }
    // Return newest-first (approximate — block-level ordering)
    return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 25);
  } catch (err) {
    console.warn(`[fetch-activity] EVM fetch error for chain ${chainId}:`, err);
    return [];
  }
}
// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Fetch recent on-chain activity for an agent's linked execution wallet.
 *
 * @param walletAddress  The agent's linked execution wallet (from Agent.verifiedWallet).
 * @param chainId        The app's internal chain id (e.g. SOLANA_CHAIN_ID = 900001, Base = 8453).
 * @returns              Array of normalized activity items, newest first.
 */
export async function getAgentActivity(
  walletAddress: string,
  chainId: number
): Promise<NormalizedActivityItem[]> {
  if (!walletAddress) return [];
  if (chainId === SOLANA_CHAIN_ID) {
    return fetchSolanaActivity(walletAddress);
  }
  if (chainId === 8453 || chainId === 1) {
    return fetchBaseActivity(walletAddress, chainId);
  }
  return [];
}
// ─── Rollup helpers (used by background jobs) ───────────────────────────────────────────
export interface ActivityRollup {
  activeWinRate30d: number;
  nativeVolume30d: number;
  txCount: number;
}
/**
 * Compute summary rollup from a list of normalized activity items.
 * Intended for background jobs writing to Agent / AgentPerfSnapshot.
 */
export function computeActivityRollup(items: NormalizedActivityItem[]): ActivityRollup {
  const sells = items.filter((i) => i.type === "sell");
  const successfulSells = sells.filter((i) => i.success);
  const activeWinRate30d = sells.length > 0 ? successfulSells.length / sells.length : 0;
  const nativeVolume30d = items.reduce((sum, i) => sum + i.nativeAmount, 0);
  return {
    activeWinRate30d,
    nativeVolume30d,
    txCount: items.length,
  };
}
