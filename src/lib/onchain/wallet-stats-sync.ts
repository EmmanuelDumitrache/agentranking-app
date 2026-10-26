/**
 * Multichain wallet stats for verified execution / revenue heuristics.
 * - EVM: Moralis Deep Index v2 token transfers when MORALIS_API_KEY is set; otherwise viem logs on Base + Ethereum.
 * - Solana: Helius address transactions (counts + optional activity rollup).
 * TODO: Add MORALIS_API_KEY and HELIUS_API_KEY to .env (see Moralis dashboard / Helius dashboard).
 */
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  readBoundedHttpBodyText,
  readBoundedJsonBody,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";
import type { Address } from "viem";
import type { Prisma } from "@/generated/prisma/client";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import {
  fetchEvmTransferLogs,
  STABLECOIN_ADDRESSES,
  type TransferLog,
} from "@/lib/blockchain/fetch-evm-transfers";
type TransferLogWithDecimals = TransferLog & { decimals?: number };
import { getAgentActivity, computeActivityRollup } from "@/lib/blockchain/fetch-activity";
const ETH_USD_RATE = Number(process.env.ETH_USD_RATE ?? "3000");
const MORALIS_BASE = "https://deep-index.moralis.io/api/v2";
/** Moralis `chain` query param per chain (mainnets). */
const MORALIS_EVM_CHAINS = ["eth", "polygon", "bsc", "arbitrum", "base"] as const;

const MoralisErc20ResponseSchema = z.object({
  result: z.array(z.object({
    to_address: z.string().optional(),
    from_address: z.string().optional(),
    address: z.string().optional(),
    value: z.string().optional(),
    decimals: z.union([z.number(), z.string()]).optional(),
  })).optional(),
});

export type WalletPerfRollup = {
  txCount: number;
  profitableTxCount: number;
  grossProfitUsd: number;
  totalFeesUsd: number;
  totalGasUsd: number;
  netPnlUsd: number;
  volumeUsd: number;
  winRate: number;
  burnToEarnRatio: number;
  avgPnlPercent: number;
};
function rawToUsd(tokenAddress: string, rawValue: bigint, decimals = 6): number {
  const addr = tokenAddress.toLowerCase();
  const divisor = 10 ** decimals;
  const amount = Number(rawValue) / divisor;
  if (STABLECOIN_ADDRESSES.has(addr)) return amount;
  return amount * ETH_USD_RATE;
}
function aggregateFromTransferLogs(inbound: TransferLogWithDecimals[], outbound: TransferLogWithDecimals[]) {
  const grossProfitUsd = inbound.reduce((sum, log) => {
    const addr = (log.address ?? "").toLowerCase();
    const val = log.args.value ?? BigInt(0);
    const dec = typeof log.decimals === "number" && Number.isFinite(log.decimals) ? log.decimals : 6;
    return sum + rawToUsd(addr, val, dec);
  }, 0);
  const totalFeesUsd = outbound.reduce((sum, log) => {
    const addr = (log.address ?? "").toLowerCase();
    const val = log.args.value ?? BigInt(0);
    const dec = typeof log.decimals === "number" && Number.isFinite(log.decimals) ? log.decimals : 6;
    return sum + rawToUsd(addr, val, dec);
  }, 0);
  const netPnlUsd = grossProfitUsd - totalFeesUsd;
  const volumeUsd = grossProfitUsd + totalFeesUsd;
  const txCount = inbound.length + outbound.length;
  const profitableTxCount = inbound.length;
  const winRate = txCount > 0 ? profitableTxCount / txCount : 0;
  const burnToEarnRatio = grossProfitUsd > 0 ? totalFeesUsd / grossProfitUsd : 0;
  const avgPnlPercent = txCount > 0 ? (netPnlUsd / volumeUsd) * 100 : 0;
  return {
    txCount,
    profitableTxCount,
    grossProfitUsd,
    totalFeesUsd,
    totalGasUsd: 0,
    netPnlUsd,
    volumeUsd,
    winRate,
    burnToEarnRatio,
    avgPnlPercent,
  };
}
type MoralisErc20Row = {
  to_address?: string;
  from_address?: string;
  address?: string;
  value?: string;
  decimals?: number | string;
};
async function moralisChainTransfers(
  wallet: string,
  chain: (typeof MORALIS_EVM_CHAINS)[number],
  apiKey: string
): Promise<MoralisErc20Row[]> {
  const url = new URL(`${MORALIS_BASE}/${wallet}/erc20/transfers`);
  url.searchParams.set("chain", chain);
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await readBoundedHttpBodyText(res, 4 * 1024).catch(() => "");
    throw new Error(`Moralis ${chain} HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await parseBoundedJsonBody(
    res,
    MoralisErc20ResponseSchema,
    4 * 1024 * 1024,
  );
  return Array.isArray(json.result) ? json.result : [];
}
function moralisRowsToInboundOutbound(walletLower: string, rows: MoralisErc20Row[]) {
  const inbound: TransferLogWithDecimals[] = [];
  const outbound: TransferLogWithDecimals[] = [];
  for (const r of rows) {
    const to = (r.to_address ?? "").toLowerCase();
    const from = (r.from_address ?? "").toLowerCase();
    const token = (r.address ?? "0x").toLowerCase();
    const decRaw = r.decimals;
    const dec =
      typeof decRaw === "string"
        ? Number.parseInt(decRaw, 10)
        : typeof decRaw === "number"
          ? decRaw
          : 18;
    const decimals = Number.isFinite(dec) ? Math.min(36, Math.max(0, dec)) : 18;
    const raw = BigInt((r.value as string | undefined) ?? "0");
    if (to === walletLower) {
      inbound.push({
        address: token,
        args: { from, to, value: raw },
        blockNumber: BigInt(0),
        transactionHash: "",
        blockHash: "",
        decimals,
      });
    } else if (from === walletLower) {
      outbound.push({
        address: token,
        args: { from, to, value: raw },
        blockNumber: BigInt(0),
        transactionHash: "",
        blockHash: "",
        decimals,
      });
    }
  }
  return { inbound, outbound };
}
function isEvmWallet(wallet: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(wallet);
}
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function isSolanaWallet(wallet: string): boolean {
  if (wallet.startsWith("0x")) return false;
  const len = wallet.length;
  if (len < 32 || len > 44) return false;
  for (let i = 0; i < len; i++) {
    if (!BASE58_ALPHABET.includes(wallet[i]!)) return false;
  }
  return true;
}
async function heliusSolanaTxCount(wallet: string): Promise<{ count: number; raw: unknown }> {
  const apiKey = process.env.HELIUS_API_KEY?.trim();
  if (!apiKey) return { count: 0, raw: { error: "HELIUS_API_KEY missing" } };
  const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${apiKey}&limit=50`;
  const res = await fetch(url, {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const t = await readBoundedHttpBodyText(res, 4 * 1024).catch(() => "");
    throw new Error(`Helius tx list HTTP ${res.status} ${t.slice(0, 120)}`);
  }
  const arr = await readBoundedJsonBody(res, 8 * 1024 * 1024);
  return { count: Array.isArray(arr) ? arr.length : 0, raw: arr };
}
/**
 * Pulls multichain stats and returns perf rollup + raw JSON for AgentPerfSnapshot.rawStatsJson.
 */
export async function syncWalletExecutionStats(
  wallet: string,
  walletChainId: number | null
): Promise<{ perf: WalletPerfRollup; rawStatsJson: Prisma.InputJsonValue } | null> {
  const w = wallet.trim();
  if (!w) return null;
  const rawParts: Record<string, unknown> = { wallet: w, walletChainId };
  if (isSolanaWallet(w)) {
    const solUsd = Number(process.env.SOL_USD_RATE ?? "150");
    let heliusCount = 0;
    let heliusRaw: unknown = null;
    try {
      const h = await heliusSolanaTxCount(w);
      heliusCount = h.count;
      heliusRaw = h.raw;
    } catch (e) {
      rawParts.heliusError = Error.isError(e) ? e.message : String(e);
    }
    rawParts.heliusTransactionsSample = heliusRaw;
    let rollup = { activeWinRate30d: 0, nativeVolume30d: 0, txCount: 0 };
    try {
      const activity = await getAgentActivity(w, SOLANA_CHAIN_ID);
      rollup = computeActivityRollup(activity);
      rawParts.solanaActivityItems = activity.length;
    } catch (e) {
      rawParts.solanaActivityError = Error.isError(e) ? e.message : String(e);
    }
    const txCount = Math.max(rollup.txCount, heliusCount);
    const sells = Math.max(1, Math.round(rollup.txCount * 0.4));
    const profitableTxCount = Math.round(sells * (rollup.activeWinRate30d || 0));
    const grossProfitUsd = rollup.nativeVolume30d * solUsd;
    const totalFeesUsd = grossProfitUsd * 0.15;
    const netPnlUsd = grossProfitUsd - totalFeesUsd;
    const volumeUsd = grossProfitUsd + totalFeesUsd;
    const winRate = txCount > 0 ? Math.min(1, profitableTxCount / txCount) : 0;
    const burnToEarnRatio = grossProfitUsd > 0 ? totalFeesUsd / grossProfitUsd : 0;
    const avgPnlPercent = volumeUsd > 0 ? (netPnlUsd / volumeUsd) * 100 : 0;
    const perf: WalletPerfRollup = {
      txCount,
      profitableTxCount,
      grossProfitUsd,
      totalFeesUsd,
      totalGasUsd: 0,
      netPnlUsd,
      volumeUsd,
      winRate,
      burnToEarnRatio,
      avgPnlPercent,
    };
    rawParts.merged = perf;
    rawParts.source = "helius_solana_heuristic";
    return { perf, rawStatsJson: rawParts as Prisma.InputJsonValue };
  }
  if (!isEvmWallet(w)) {
    rawParts.error = "unsupported_wallet_format";
    return {
      perf: {
        txCount: 0,
        profitableTxCount: 0,
        grossProfitUsd: 0,
        totalFeesUsd: 0,
        totalGasUsd: 0,
        netPnlUsd: 0,
        volumeUsd: 0,
        winRate: 0,
        burnToEarnRatio: 0,
        avgPnlPercent: 0,
      },
      rawStatsJson: rawParts as Prisma.InputJsonValue,
    };
  }
  const walletLower = w.toLowerCase();
  const moralisKey = process.env.MORALIS_API_KEY?.trim();
  if (moralisKey) {
    const byChain: Record<string, MoralisErc20Row[]> = {};
    let allInbound: TransferLog[] = [];
    let allOutbound: TransferLog[] = [];
    for (const chain of MORALIS_EVM_CHAINS) {
      try {
        const rows = await moralisChainTransfers(walletLower, chain, moralisKey);
        byChain[chain] = rows;
        const { inbound, outbound } = moralisRowsToInboundOutbound(walletLower, rows);
        allInbound = allInbound.concat(inbound);
        allOutbound = allOutbound.concat(outbound);
      } catch (e) {
        byChain[chain] = [];
        rawParts[`moralisError_${chain}`] = Error.isError(e) ? e.message : String(e);
      }
      await delay(
        Number.parseInt(process.env.MORALIS_CHAIN_DELAY_MS ?? "120", 10) || 120,
        undefined,
        { ref: false },
      );
    }
    rawParts.moralisByChain = byChain;
    const perf = aggregateFromTransferLogs(allInbound, allOutbound);
    rawParts.merged = perf;
    rawParts.source = "moralis_multichain_v2";
    return { perf, rawStatsJson: rawParts as Prisma.InputJsonValue };
  }
  const chainId = walletChainId === 1 || walletChainId === 8453 ? walletChainId : 8453;
  let inbound: TransferLog[] = [];
  let outbound: TransferLog[] = [];
  try {
    const logs = await fetchEvmTransferLogs(walletLower as Address, chainId);
    inbound = logs.inbound;
    outbound = logs.outbound;
  } catch (e) {
    rawParts.viemError = Error.isError(e) ? e.message : String(e);
    return null;
  }
  rawParts.viemChainId = chainId;
  rawParts.source = "viem_rpc_fallback";
  const perf = aggregateFromTransferLogs(inbound, outbound);
  rawParts.merged = perf;
  return { perf, rawStatsJson: rawParts as Prisma.InputJsonValue };
}