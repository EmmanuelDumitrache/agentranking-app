import "server-only";
import { getPublicApiCached } from "@/lib/public-api-cache";
import { Connection, PublicKey } from "@solana/web3.js";
import { createTimedSolanaConnection } from "@/lib/solana-rpc-connection.server";
import { mapWithConcurrency } from "@/lib/async-pool";
import { resolveArOpsWallet, resolveArSolanaMint } from "@/lib/ar-token-public";
import { getDexscreenerMarketForMint } from "@/lib/public-site/dexscreener";
import { streamflowRpcEndpoint } from "@/lib/streamflow-stake-config";
import { isSolanaRpcRateLimitError } from "@/lib/solana-rpc-errors";
export type ArBuybackSummary = {
  buybacksUsd: number;
  buybacksAr: number;
  buybacksSol: number;
  buybackCount: number;
  source: "ops-wallet" | "unavailable";
  readAt: string;
  error?: string;
};
const BUYBACK_CACHE_SECONDS = 180;
const BUYBACK_TIMEOUT_MS = 14_000;
const SIGNATURE_LIMIT = 24;
const PARSE_CONCURRENCY = 4;
type ParsedTx = Awaited<ReturnType<Connection["getParsedTransaction"]>>;
async function resolveOpsArAta(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey,
): Promise<PublicKey | null> {
  const accounts = await connection.getParsedTokenAccountsByOwner(wallet, {
    mint,
  });
  const first = accounts.value[0];
  return first ? first.pubkey : null;
}
function accountKeyString(key: unknown): string {
  if (!key) return "";
  if (typeof key === "string") return key;
  if (typeof key === "object") {
    const record = key as {
      pubkey?: { toBase58?: () => string } | string;
      toBase58?: () => string;
    };
    if (typeof record.pubkey === "string") return record.pubkey;
    if (record.pubkey && typeof record.pubkey.toBase58 === "function") {
      return record.pubkey.toBase58();
    }
    if (typeof record.toBase58 === "function") return record.toBase58();
  }
  return "";
}
function classifyBuyFromTx(
  tx: ParsedTx,
  opsWallet: string,
  mint: string,
): { amountToken: number; amountSol: number } | null {
  if (!tx?.meta || tx.meta.err) return null;
  const pre = tx.meta.preTokenBalances ?? [];
  const post = tx.meta.postTokenBalances ?? [];
  let amountToken = 0;
  for (const row of post) {
    if (row.mint !== mint || row.owner !== opsWallet) continue;
    const before = pre.find(
      (candidate) =>
        candidate.accountIndex === row.accountIndex && candidate.mint === mint,
    );
    const delta =
      Number(row.uiTokenAmount?.uiAmount ?? 0) -
      Number(before?.uiTokenAmount?.uiAmount ?? 0);
    if (delta > 0) amountToken += delta;
  }
  if (amountToken <= 0) return null;
  const keys = tx.transaction.message.accountKeys ?? [];
  const opsIndex = keys.findIndex(
    (key) => accountKeyString(key) === opsWallet,
  );
  let amountSol = 0;
  if (
    opsIndex >= 0 &&
    tx.meta.preBalances?.[opsIndex] != null &&
    tx.meta.postBalances?.[opsIndex] != null
  ) {
    const lamportsSpent =
      tx.meta.preBalances[opsIndex] - tx.meta.postBalances[opsIndex];
    if (lamportsSpent > 0) amountSol = lamportsSpent / 1e9;
  }
  return { amountToken, amountSol };
}
async function readBuybacksFromAta(
  connection: Connection,
  opsWallet: string,
  mint: string,
  ata: PublicKey,
): Promise<{ buybacksAr: number; buybacksSol: number; buybackCount: number }> {
  const signatures = await connection.getSignaturesForAddress(ata, {
    limit: SIGNATURE_LIMIT,
  });
  const parsed = await mapWithConcurrency(
    signatures,
    PARSE_CONCURRENCY,
    async (row) =>
      connection.getParsedTransaction(row.signature, {
        maxSupportedTransactionVersion: 0,
      }),
  );
  let buybacksAr = 0;
  let buybacksSol = 0;
  let buybackCount = 0;
  for (const tx of parsed) {
    const buy = classifyBuyFromTx(tx, opsWallet, mint);
    if (!buy) continue;
    buybacksAr += buy.amountToken;
    buybacksSol += buy.amountSol;
    buybackCount += 1;
  }
  return { buybacksAr, buybacksSol, buybackCount };
}
async function readArBuybackSummaryUncached(
  wallet: string,
  mint: string,
): Promise<ArBuybackSummary> {
  const readAt = new Date().toISOString();
  try {
    const rpcDeadline = AbortSignal.timeout(BUYBACK_TIMEOUT_MS);
    const connection = createTimedSolanaConnection(streamflowRpcEndpoint(), {
      commitment: "confirmed",
      signal: rpcDeadline,
    });
    const walletPk = new PublicKey(wallet);
    const mintPk = new PublicKey(mint);
    const ata = await resolveOpsArAta(connection, walletPk, mintPk);
    const summary = ata
      ? await readBuybacksFromAta(connection, wallet, mint, ata)
      : { buybacksAr: 0, buybacksSol: 0, buybackCount: 0 };
    let buybacksUsd = 0;
    if (summary.buybacksAr > 0) {
      const market = await getDexscreenerMarketForMint(mint);
      if (market?.priceUsd && market.priceUsd > 0) {
        buybacksUsd = summary.buybacksAr * market.priceUsd;
      }
    }
    return {
      buybacksUsd,
      buybacksAr: summary.buybacksAr,
      buybacksSol: summary.buybacksSol,
      buybackCount: summary.buybackCount,
      source: "ops-wallet",
      readAt,
    };
  } catch (error) {
    const rateLimited = isSolanaRpcRateLimitError(error);
    const message = rateLimited
      ? "Solana RPC rate limited"
      : Error.isError(error)
        ? error.message
        : String(error);
    console.error("[ar-buyback-summary] read failed:", message);
    return {
      buybacksUsd: 0,
      buybacksAr: 0,
      buybacksSol: 0,
      buybackCount: 0,
      source: "unavailable",
      readAt,
      error: message,
    };
  }
}
function isArBuybackSummary(value: unknown): value is ArBuybackSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Partial<ArBuybackSummary>;
  return (
    [row.buybacksUsd, row.buybacksAr, row.buybacksSol, row.buybackCount].every(
      (amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0,
    ) &&
    (row.source === "ops-wallet" || row.source === "unavailable") &&
    typeof row.readAt === "string" &&
    Number.isFinite(Date.parse(row.readAt)) &&
    (row.error === undefined || typeof row.error === "string")
  );
}
export async function readArBuybackSummary(): Promise<ArBuybackSummary> {
  const wallet = resolveArOpsWallet();
  const mint = resolveArSolanaMint();
  const result = await getPublicApiCached({
    key: `ar-buyback-summary:${wallet}:${mint}`,
    freshTtlSeconds: BUYBACK_CACHE_SECONDS,
    staleTtlSeconds: 15 * 60,
    maxPayloadBytes: 16 * 1_024,
    leaseTtlMs: 30_000,
    leaseWaitMs: 15_000,
    load: () => readArBuybackSummaryUncached(wallet, mint),
    validate: isArBuybackSummary,
  });
  return result.value;
}
