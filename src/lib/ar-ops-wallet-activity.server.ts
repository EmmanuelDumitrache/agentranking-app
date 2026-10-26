import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ArOpsChainEvent, ArOpsWalletActivityPayload } from "@/lib/ar-ops-wallet-activity-types";
import { resolveArOpsWallet, resolveArSolanaMint, SOLANA_INCINERATOR } from "@/lib/ar-token-public";
import {
  readBoundedHttpBodyText,
  readBoundedJsonBody,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";
import {
  readExternalProviderCache,
  writeExternalProviderCache,
} from "@/lib/external-provider-cache";
import { getOrInsertComputed } from "@/lib/map-upsert";

const DexscreenerPriceSchema = z.object({
  pairs: z.array(z.object({
    priceUsd: z.string().optional(),
  })).optional(),
});
const HELIUS_V0 = "https://api.helius.xyz/v0";
const SOL_MINT = "So11111111111111111111111111111111111111112";
interface HeliusTokenTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
  from?: string;
  to?: string;
  mint?: string;
  tokenAmount?: number;
  amount?: number;
  usdValue?: number;
}
interface HeliusSwapEvent {
  nativeInput?: { account?: string; amount?: number } | null;
  nativeOutput?: { account?: string; amount?: number } | null;
  tokenInputs?: Array<{ mint?: string; tokenAmount?: number; rawTokenAmount?: { tokenAmount?: string; decimals?: number } }>;
  tokenOutputs?: Array<{ mint?: string; tokenAmount?: number; rawTokenAmount?: { tokenAmount?: string; decimals?: number } }>;
}
interface HeliusTokenBalanceChange {
  userAccount?: string;
  mint?: string;
  rawTokenAmount?: { tokenAmount?: string; decimals?: number };
}
interface HeliusAccountData {
  account?: string;
  nativeBalanceChange?: number;
  tokenBalanceChanges?: HeliusTokenBalanceChange[];
}
interface HeliusEnhancedTx {
  signature?: string;
  tx?: string;
  type?: string;
  source?: string;
  description?: string;
  timestamp?: number;
  transactionError?: unknown;
  tokenTransfers?: HeliusTokenTransfer[];
  nativeTransfers?: Array<{ from?: string; to?: string; amount?: number; usdValue?: number }>;
  accountData?: HeliusAccountData[];
  events?: { swap?: HeliusSwapEvent };
}
function resolveTradeMints(canonicalMint: string): Set<string> {
  const mints = new Set<string>([canonicalMint]);
  const extra = process.env.AR_OPS_TRADE_MINTS?.trim();
  if (extra) {
    for (const part of extra.split(/[,\s]+/)) {
      const m = part.trim();
      if (m.length >= 32) mints.add(m);
    }
  }
  return mints;
}
function rawTokenToUi(raw: string | undefined, decimals: number | undefined): number {
  if (!raw) return 0;
  try {
    const n = Number(raw);
    const dec = typeof decimals === "number" ? decimals : 9;
    return n / 10 ** dec;
  } catch {
    return 0;
  }
}
function txIncludesWallet(tx: HeliusEnhancedTx, wallet: string): boolean {
  if (!wallet) return false;
  for (const a of tx.accountData ?? []) {
    if (a.account === wallet) return true;
  }
  return false;
}
type UserFlow = {
  solOut: number;
  solIn: number;
  tokenIn: Map<string, number>;
  tokenOut: Map<string, number>;
};
function userFlowsForTx(tx: HeliusEnhancedTx): Map<string, UserFlow> {
  const flows = new Map<string, UserFlow>();
  const ensure = (user: string): UserFlow =>
    getOrInsertComputed(flows, user, () => ({
      solOut: 0,
      solIn: 0,
      tokenIn: new Map(),
      tokenOut: new Map(),
    }));
  for (const t of tx.tokenTransfers ?? []) {
    const from = t.fromUserAccount ?? t.from ?? "";
    const to = t.toUserAccount ?? t.to ?? "";
    const mint = t.mint ?? "";
    const amt = transferAmountUi(t);
    if (!mint || amt <= 0) continue;
    if (mint === SOL_MINT) {
      if (from) ensure(from).solOut += amt;
      if (to) ensure(to).solIn += amt;
      continue;
    }
    if (from) ensure(from).tokenOut.set(mint, (ensure(from).tokenOut.get(mint) ?? 0) + amt);
    if (to) ensure(to).tokenIn.set(mint, (ensure(to).tokenIn.get(mint) ?? 0) + amt);
  }
  for (const n of tx.nativeTransfers ?? []) {
    const from = n.from ?? "";
    const to = n.to ?? "";
    const lamports = n.amount ?? 0;
    if (lamports <= 0) continue;
    const sol = lamports / 1e9;
    if (from) ensure(from).solOut += sol;
    if (to) ensure(to).solIn += sol;
  }
  const swap = tx.events?.swap;
  if (swap?.nativeInput?.account && (swap.nativeInput.amount ?? 0) > 0) {
    ensure(swap.nativeInput.account).solOut += (swap.nativeInput.amount ?? 0) / 1e9;
  }
  if (swap?.nativeOutput?.account && (swap.nativeOutput.amount ?? 0) > 0) {
    ensure(swap.nativeOutput.account).solIn += (swap.nativeOutput.amount ?? 0) / 1e9;
  }
  for (const a of tx.accountData ?? []) {
    for (const c of a.tokenBalanceChanges ?? []) {
      const user = c.userAccount ?? "";
      const mint = c.mint ?? "";
      if (!user || !mint) continue;
      const ui = rawTokenToUi(c.rawTokenAmount?.tokenAmount, c.rawTokenAmount?.decimals);
      if (ui === 0) continue;
      const row = ensure(user);
      if (mint === SOL_MINT) {
        if (ui < 0) row.solOut += Math.abs(ui);
        else row.solIn += ui;
      } else if (ui > 0) {
        row.tokenIn.set(mint, (row.tokenIn.get(mint) ?? 0) + ui);
      } else {
        row.tokenOut.set(mint, (row.tokenOut.get(mint) ?? 0) + Math.abs(ui));
      }
    }
    if (typeof a.nativeBalanceChange === "number" && a.nativeBalanceChange !== 0 && a.account) {
      const sol = Math.abs(a.nativeBalanceChange) / 1e9;
      const row = ensure(a.account);
      if (a.nativeBalanceChange < 0) row.solOut += sol;
      else row.solIn += sol;
    }
  }
  return flows;
}
function opsTxLimit(): number {
  const raw = process.env.AR_OPS_HELIUS_TX_LIMIT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 100;
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(10, n));
}
function txSignature(tx: HeliusEnhancedTx): string | null {
  const s = tx.signature ?? tx.tx;
  return s && typeof s === "string" ? s : null;
}
function normalizeAddressTxResponse(data: unknown): HeliusEnhancedTx[] {
  if (Array.isArray(data)) return data as HeliusEnhancedTx[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.transactions)) return o.transactions as HeliusEnhancedTx[];
    if (Array.isArray(o.items)) return o.items as HeliusEnhancedTx[];
  }
  return [];
}
async function heliusGet(pathWithQuery: string, apiKey: string): Promise<unknown> {
  const sep = pathWithQuery.includes("?") ? "&" : "?";
  const url = `${HELIUS_V0}${pathWithQuery}${sep}api-key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await readBoundedHttpBodyText(res, 4 * 1024).catch(() => "");
    throw new Error(`Helius GET failed HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  }
  return readBoundedJsonBody(res, 16 * 1024 * 1024);
}
async function heliusPostTransactions(signatures: string[], apiKey: string): Promise<HeliusEnhancedTx[]> {
  if (signatures.length === 0) return [];
  const url = `${HELIUS_V0}/transactions?api-key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: signatures, commitment: "confirmed" }),
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const data = await readBoundedJsonBody(res, 16 * 1024 * 1024);
  return Array.isArray(data) ? (data as HeliusEnhancedTx[]) : [];
}
async function mergeEnrichedTransactions(txs: HeliusEnhancedTx[], apiKey: string): Promise<HeliusEnhancedTx[]> {
  const thin = txs.filter((t) => {
    const has =
      (t.tokenTransfers && t.tokenTransfers.length > 0) ||
      (t.nativeTransfers && t.nativeTransfers.length > 0) ||
      t.events?.swap;
    return !has;
  });
  if (thin.length === 0) return txs;
  const sigs = thin.map((t) => txSignature(t)).filter((s): s is string => Boolean(s));
  const enriched: HeliusEnhancedTx[] = [];
  for (let i = 0; i < sigs.length; i += 100) {
    enriched.push(...(await heliusPostTransactions(sigs.slice(i, i + 100), apiKey)));
  }
  const bySig = new Map(enriched.map((t) => [txSignature(t), t] as const));
  return txs.map((t) => {
    const sig = txSignature(t);
    if (!sig) return t;
    return bySig.get(sig) ?? t;
  });
}
function transferAmountUi(t: HeliusTokenTransfer): number {
  if (typeof t.tokenAmount === "number" && Number.isFinite(t.tokenAmount)) return t.tokenAmount;
  if (typeof t.amount === "number" && Number.isFinite(t.amount)) return t.amount;
  return 0;
}
function isBurnDestination(to: string): boolean {
  const lower = to.toLowerCase();
  if (to === SOLANA_INCINERATOR) return true;
  if (lower.includes("incinerator")) return true;
  return false;
}
function txOccurredAt(tx: HeliusEnhancedTx): string {
  return new Date(
    typeof tx.timestamp === "number" && tx.timestamp > 0
      ? tx.timestamp > 1e12
        ? tx.timestamp
        : tx.timestamp * 1000
      : Date.now(),
  ).toISOString();
}
function classifyTransaction(
  tx: HeliusEnhancedTx,
  opsWallet: string,
  tradeMints: Set<string>,
): ArOpsChainEvent[] {
  const sig = txSignature(tx);
  if (!sig || tx.transactionError != null) return [];
  if (!txIncludesWallet(tx, opsWallet)) return [];
  const occurredAt = txOccurredAt(tx);
  const source = [tx.type, tx.source].filter(Boolean).join(" · ") || "solana";
  const solscanUrl = `https://solscan.io/tx/${sig}`;
  const out: ArOpsChainEvent[] = [];
  const typeUpper = (tx.type ?? "").toUpperCase();
  for (const t of tx.tokenTransfers ?? []) {
    const from = t.fromUserAccount ?? t.from ?? "";
    const to = t.toUserAccount ?? t.to ?? "";
    const mint = t.mint ?? "";
    if (!tradeMints.has(mint)) continue;
    const amountToken = transferAmountUi(t);
    if (amountToken <= 0) continue;
    const usd =
      typeof t.usdValue === "number" && Number.isFinite(t.usdValue) && t.usdValue > 0 ? t.usdValue : 0;
    if (from === opsWallet && to !== opsWallet && isBurnDestination(to)) {
      out.push({
        kind: "burn",
        signature: sig,
        occurredAt,
        amountToken,
        amountSol: 0,
        amountUsd: usd,
        counterparty: to,
        source,
        solscanUrl,
      });
    }
  }
  if (typeUpper.includes("BURN")) {
    for (const t of tx.tokenTransfers ?? []) {
      const mint = t.mint ?? "";
      if (!tradeMints.has(mint)) continue;
      const to = t.toUserAccount ?? t.to ?? "";
      if (!isBurnDestination(to)) continue;
      const amountToken = transferAmountUi(t);
      if (amountToken <= 0) continue;
      if (out.some((e) => e.kind === "burn" && e.signature === sig)) continue;
      out.push({
        kind: "burn",
        signature: sig,
        occurredAt,
        amountToken,
        amountSol: 0,
        amountUsd: typeof t.usdValue === "number" ? t.usdValue : 0,
        counterparty: to,
        source,
        solscanUrl,
      });
    }
  }
  const flows = userFlowsForTx(tx);
  let bestBuy: { user: string; mint: string; amountToken: number; amountSol: number } | null = null;
  for (const [user, flow] of flows) {
    if (flow.solOut < 0.000_01) continue;
    for (const mint of tradeMints) {
      const bought = flow.tokenIn.get(mint) ?? 0;
      const sold = flow.tokenOut.get(mint) ?? 0;
      if (bought <= 0 || sold >= bought) continue;
      const amountToken = bought - sold;
      if (!bestBuy || flow.solOut > bestBuy.amountSol) {
        bestBuy = { user, mint, amountToken, amountSol: flow.solOut };
      }
    }
  }
  if (bestBuy && !out.some((e) => e.kind === "buyback" && e.signature === sig)) {
    out.push({
      kind: "buyback",
      signature: sig,
      occurredAt,
      amountToken: bestBuy.amountToken,
      amountSol: bestBuy.amountSol,
      amountUsd: 0,
      counterparty: bestBuy.user,
      source,
      solscanUrl,
    });
  }
  const deduped = new Map<string, ArOpsChainEvent>();
  for (const e of out) {
    deduped.set(`${e.kind}:${e.signature}`, e);
  }
  return [...deduped.values()];
}
function countNonTradeSwaps(txs: HeliusEnhancedTx[], tradeMints: Set<string>, opsWallet: string): number {
  let count = 0;
  for (const tx of txs) {
    if ((tx.type ?? "").toUpperCase() !== "SWAP") continue;
    if (!txIncludesWallet(tx, opsWallet)) continue;
    const flows = userFlowsForTx(tx);
    let hasTradeBuy = false;
    let hasOtherBuy = false;
    for (const flow of flows.values()) {
      if (flow.solOut < 0.000_01) continue;
      for (const [mint, amt] of flow.tokenIn) {
        if (amt <= 0) continue;
        if (tradeMints.has(mint)) hasTradeBuy = true;
        else hasOtherBuy = true;
      }
    }
    if (hasOtherBuy && !hasTradeBuy) count += 1;
  }
  return count;
}
function buildCumulativeSeries(events: ArOpsChainEvent[]) {
  const byDay = new Map<string, { buybackUsd: number; burnedToken: number }>();
  for (const e of [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const day = e.occurredAt.slice(0, 10);
    const row = getOrInsertComputed(byDay, day, () => ({ buybackUsd: 0, burnedToken: 0 }));
    if (e.kind === "buyback") row.buybackUsd += e.amountUsd > 0 ? e.amountUsd : 0;
    if (e.kind === "burn") row.burnedToken += e.amountToken;
  }
  let buybackUsdCumulative = 0;
  let burnedTokenCumulative = 0;
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => {
      buybackUsdCumulative += row.buybackUsd;
      burnedTokenCumulative += row.burnedToken;
      return {
        date,
        buybackUsd: row.buybackUsd,
        burnedToken: row.burnedToken,
        buybackUsdCumulative,
        burnedTokenCumulative,
      };
    });
}
async function fetchHeliusOpsTransactions(wallet: string, apiKey: string): Promise<HeliusEnhancedTx[]> {
  const limit = opsTxLimit();
  const base = `/addresses/${encodeURIComponent(wallet)}/transactions`;
  const queries = [
    `${base}?type=SWAP&limit=${limit}`,
    `${base}?type=TRANSFER&limit=${limit}`,
    `${base}?limit=${limit}`,
  ];
  const bySig = new Map<string, HeliusEnhancedTx>();
  let lastErr: unknown;
  for (const q of queries) {
    try {
      const raw = await heliusGet(q, apiKey);
      for (const tx of normalizeAddressTxResponse(raw)) {
        const sig = txSignature(tx);
        if (sig) bySig.set(sig, tx);
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (bySig.size === 0) throw lastErr ?? new Error("Helius fetch failed");
  return mergeEnrichedTransactions([...bySig.values()], apiKey);
}
function isPositiveUsdPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
async function fetchArSpotUsd(mint: string): Promise<number> {
  const cacheKey = `market-price:ar-usd:${mint}`;
  const cached = await readExternalProviderCache({
    key: cacheKey,
    validate: isPositiveUsdPrice,
    freshTtlSeconds: 60,
    staleTtlSeconds: 15 * 60,
    maxPayloadBytes: 1_024,
  });
  if (cached?.status === "fresh") return cached.value;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return cached?.value ?? 0;
    const data = await parseBoundedJsonBody(
      res,
      DexscreenerPriceSchema,
      2 * 1024 * 1024,
    );
    const price = Number.parseFloat(data.pairs?.[0]?.priceUsd ?? "");
    if (!isPositiveUsdPrice(price)) return cached?.value ?? 0;
    await writeExternalProviderCache({
      key: cacheKey,
      value: price,
      validate: isPositiveUsdPrice,
      freshTtlSeconds: 60,
      staleTtlSeconds: 15 * 60,
      maxPayloadBytes: 1_024,
    });
    return price;
  } catch {
    return cached?.value ?? 0;
  }
}
function enrichUsd(events: ArOpsChainEvent[], spotUsd: number): ArOpsChainEvent[] {
  if (spotUsd <= 0) return events;
  return events.map((e) => {
    if (e.kind !== "buyback" || e.amountUsd > 0) return e;
    return { ...e, amountUsd: e.amountToken * spotUsd };
  });
}
export async function fetchArOpsWalletActivity(options: { syncToDb?: boolean } = {}): Promise<ArOpsWalletActivityPayload> {
  const wallet = resolveArOpsWallet();
  const mint = resolveArSolanaMint();
  const apiKey = process.env.HELIUS_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return {
      wallet,
      mint,
      heliusConfigured: false,
      fetchedAt: new Date().toISOString(),
      totals: { buybackCount: 0, burnCount: 0, buybackToken: 0, buybackUsd: 0, burnedToken: 0 },
      events: [],
      cumulativeSeries: [],
      syncedToDb: 0,
      error: "HELIUS_API_KEY is not set — add it to .env.local to index on-chain buybacks and burns.",
    };
  }
  try {
    const tradeMints = resolveTradeMints(mint);
    const txs = await fetchHeliusOpsTransactions(wallet, apiKey);
    const classified: ArOpsChainEvent[] = [];
    for (const tx of txs) {
      classified.push(...classifyTransaction(tx, wallet, tradeMints));
    }
    const spotUsd = await fetchArSpotUsd(mint);
    const events = enrichUsd(classified, spotUsd).sort(
      (a, b) => b.occurredAt.localeCompare(a.occurredAt),
    );
    const warnings: string[] = [];
    const otherSwaps = countNonTradeSwaps(txs, tradeMints, wallet);
    if (events.filter((e) => e.kind === "buyback").length === 0 && otherSwaps > 0) {
      warnings.push(
        `Found ${otherSwaps} recent Pump/DEX swap(s) on this wallet that did not receive the canonical $AR mint (${mint.slice(0, 8)}…). Solscan may label them as “AMM: Buy” for other tokens. Buybacks on Live Stats only count SOL → $AR for that mint.`,
      );
    }
    const totals = {
      buybackCount: events.filter((e) => e.kind === "buyback").length,
      burnCount: events.filter((e) => e.kind === "burn").length,
      buybackToken: events.filter((e) => e.kind === "buyback").reduce((s, e) => s + e.amountToken, 0),
      buybackUsd: events.filter((e) => e.kind === "buyback").reduce((s, e) => s + e.amountUsd, 0),
      burnedToken: events.filter((e) => e.kind === "burn").reduce((s, e) => s + e.amountToken, 0),
    };
    let syncedToDb = 0;
    if (options.syncToDb && events.length > 0) {
      syncedToDb = await syncOpsEventsToMetricEvents(wallet, events, spotUsd);
    }
    return {
      wallet,
      mint,
      heliusConfigured: true,
      fetchedAt: new Date().toISOString(),
      totals,
      events,
      cumulativeSeries: buildCumulativeSeries(events),
      syncedToDb,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    return {
      wallet,
      mint,
      heliusConfigured: true,
      fetchedAt: new Date().toISOString(),
      totals: { buybackCount: 0, burnCount: 0, buybackToken: 0, buybackUsd: 0, burnedToken: 0 },
      events: [],
      cumulativeSeries: [],
      syncedToDb: 0,
      error: msg,
    };
  }
}
export async function syncOpsEventsToMetricEvents(
  wallet: string,
  events: ArOpsChainEvent[],
  spotUsd: number,
): Promise<number> {
  let created = 0;
  for (const e of events) {
    const eventType = e.kind === "burn" ? "burn" : "buyback";
    const existing = await prisma.arTokenMetricEvent.findFirst({
      where: { eventType, txHash: e.signature },
      select: { id: true },
    });
    if (existing) continue;
    const amountUsd =
      e.kind === "buyback"
        ? String(e.amountUsd > 0 ? e.amountUsd : e.amountToken * spotUsd)
        : e.amountUsd > 0
          ? String(e.amountUsd)
          : "";
    await prisma.arTokenMetricEvent.create({
      data: {
        eventType,
        amountToken: String(e.amountToken),
        amountUsd,
        wallet,
        txHash: e.signature,
        note: `On-chain ${eventType} (Helius)`,
        occurredAt: new Date(e.occurredAt),
      },
    });
    created += 1;
  }
  return created;
}
