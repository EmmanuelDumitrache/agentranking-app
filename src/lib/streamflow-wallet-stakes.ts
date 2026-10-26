import { PublicKey } from "@solana/web3.js";
import { SolanaStakingClient } from "@streamflow/staking";
import { formatUnits } from "viem";
import { prisma } from "@/lib/db";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
import { resolveArTokenDecimals } from "@/lib/ar-token-public";
import { valkeyDeleteKeys, valkeyGetJson, valkeyGetString, valkeySetJson, valkeySetStringPx } from "@/lib/valkey";
import {
  DEFAULT_STREAMFLOW_STAKE_POOL,
  streamflowICluster,
  streamflowRpcEndpoint,
  streamflowStakePoolDefaults,
} from "@/lib/streamflow-stake-config";
export type WalletStakePositionView = {
  id: string;
  poolAddress: string;
  mintAddress: string;
  stakeAccount: string;
  amountUi: string;
  amountRaw: string;
  nonce: number;
  durationSec: number;
  lockStartAt: string | null;
  lockEndAt: string | null;
  createdAt: string;
  txSignature: string;
  source: "streamflow" | "database";
};
type StakeEntryAccount = {
  nonce: number;
  payer: PublicKey;
  amount: { toString(): string };
  duration: { toString(): string };
  createdTs: { toString(): string };
  closedTs: { toString(): string };
};
const WALLET_POSITIONS_CACHE_SECONDS = 45;
const POOL_MINT_CACHE_MS = 24 * 60 * 60_000;
function walletPositionsCacheKey(wallet: string, poolAddress: string): string {
  return `streamflow:wallet-positions:v1:${poolAddress}:${wallet}`;
}
function poolMintCacheKey(poolAddress: string): string {
  return `streamflow:pool-mint:v1:${poolAddress}`;
}
function isWalletStakePositionView(value: unknown): value is WalletStakePositionView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.poolAddress === "string" &&
    typeof row.mintAddress === "string" &&
    typeof row.stakeAccount === "string" &&
    typeof row.amountUi === "string" &&
    typeof row.amountRaw === "string" &&
    typeof row.nonce === "number" &&
    Number.isSafeInteger(row.nonce) &&
    typeof row.durationSec === "number" &&
    Number.isSafeInteger(row.durationSec) &&
    (row.lockStartAt === null || typeof row.lockStartAt === "string") &&
    (row.lockEndAt === null || typeof row.lockEndAt === "string") &&
    typeof row.createdAt === "string" &&
    typeof row.txSignature === "string" &&
    (row.source === "streamflow" || row.source === "database")
  );
}
function isWalletStakePositions(value: unknown): value is WalletStakePositionView[] {
  return Array.isArray(value) && value.every(isWalletStakePositionView);
}
function stakingClient(): SolanaStakingClient {
  return new SolanaStakingClient({
    clusterUrl: streamflowRpcEndpoint(),
    cluster: streamflowICluster(),
  });
}
export function resolveStreamflowPoolAddress(): string {
  return streamflowStakePoolDefaults().stakePool.trim() || DEFAULT_STREAMFLOW_STAKE_POOL;
}
export async function resolveStreamflowPoolMint(poolAddress: string): Promise<string> {
  const fromEnv = streamflowStakePoolDefaults().stakePoolMint.trim();
  if (fromEnv) return fromEnv;
  const key = poolMintCacheKey(poolAddress);
  const cached = await valkeyGetString(key);
  if (cached) return cached;
  const client = stakingClient();
  const pool = await client.getStakePool(new PublicKey(poolAddress));
  const mint = pool.stakeMint.toBase58();
  await valkeySetStringPx(key, mint, POOL_MINT_CACHE_MS);
  return mint;
}
function formatStakeAmountUi(amountRaw: string, decimals: number): string {
  if (!/^\d+$/.test(amountRaw)) return "0";
  const s = formatUnits(BigInt(amountRaw), decimals);
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}
/** Active stake entries for a wallet on the configured Streamflow pool (on-chain source of truth). */
export async function fetchWalletStreamflowStakePositions(
  wallet: string,
  opts?: { skipCache?: boolean },
): Promise<WalletStakePositionView[]> {
  const normalized = normalizeStakeWallet(wallet);
  if (!normalized) return [];
  const poolAddress = resolveStreamflowPoolAddress();
  const cacheKey = walletPositionsCacheKey(normalized, poolAddress);
  if (!opts?.skipCache) {
    const hit = await valkeyGetJson<unknown>(cacheKey);
    if (isWalletStakePositions(hit)) return hit;
    if (hit !== null) await valkeyDeleteKeys([cacheKey]);
  }
  let poolPk: PublicKey;
  let payerPk: PublicKey;
  try {
    poolPk = new PublicKey(poolAddress);
    payerPk = new PublicKey(normalized);
  } catch {
    return [];
  }
  const client = stakingClient();
  const [entries, mintAddress] = await Promise.all([
    client.searchStakeEntries({ stakePool: poolPk, payer: payerPk }),
    resolveStreamflowPoolMint(poolAddress),
  ]);
  const decimals = resolveArTokenDecimals();
  const rows: WalletStakePositionView[] = [];
  for (const row of entries) {
    const acct = row.account as StakeEntryAccount;
    const closedTs = Number(acct.closedTs?.toString() ?? "0");
    if (closedTs > 0) continue;
    const nonce = Number(acct.nonce);
    const amountRaw = acct.amount.toString();
    const durationSec = Number(acct.duration.toString());
    const createdTs = Number(acct.createdTs.toString());
    const lockStartAt =
      createdTs > 0 ? new Date(createdTs * 1000).toISOString() : new Date().toISOString();
    const lockEndAt =
      durationSec > 0 && createdTs > 0
        ? new Date((createdTs + durationSec) * 1000).toISOString()
        : null;
    rows.push({
      id: `streamflow:${poolAddress}:${nonce}`,
      poolAddress,
      mintAddress,
      stakeAccount: row.publicKey.toBase58(),
      amountUi: formatStakeAmountUi(amountRaw, decimals),
      amountRaw,
      nonce,
      durationSec,
      lockStartAt,
      lockEndAt,
      createdAt: lockStartAt,
      txSignature: "",
      source: "streamflow",
    });
  }
  rows.sort((a, b) => {
    const aEnd = a.lockEndAt ? new Date(a.lockEndAt).getTime() : 0;
    const bEnd = b.lockEndAt ? new Date(b.lockEndAt).getTime() : 0;
    return aEnd - bEnd;
  });
  await valkeySetJson(cacheKey, rows, WALLET_POSITIONS_CACHE_SECONDS);
  return rows;
}
/** Persist Streamflow positions so holder perks and recorded stake use the same authoritative state. */
export async function syncStreamflowPositionsToDatabase(
  wallet: string,
  positions: readonly WalletStakePositionView[],
): Promise<void> {
  const normalized = normalizeStakeWallet(wallet);
  if (!normalized) return;
  const now = new Date();
  for (const pos of positions) {
    if (pos.source !== "streamflow") continue;
    const lockStartAt = pos.lockStartAt ? new Date(pos.lockStartAt) : now;
    const lockEndAt = pos.lockEndAt ? new Date(pos.lockEndAt) : null;
    await prisma.arStakePosition.upsert({
      where: {
        wallet_nonce_poolAddress: {
          wallet: normalized,
          nonce: pos.nonce,
          poolAddress: pos.poolAddress,
        },
      },
      create: {
        wallet: normalized,
        poolAddress: pos.poolAddress,
        mintAddress: pos.mintAddress,
        stakeAccount: pos.stakeAccount,
        amountRaw: pos.amountRaw,
        amountUi: pos.amountUi,
        nonce: pos.nonce,
        durationSec: pos.durationSec,
        lockStartAt,
        lockEndAt,
        txSignature: pos.txSignature,
        status: "active",
        source: "streamflow",
        lastSyncedAt: now,
      },
      update: {
        stakeAccount: pos.stakeAccount,
        mintAddress: pos.mintAddress,
        amountRaw: pos.amountRaw,
        amountUi: pos.amountUi,
        durationSec: pos.durationSec,
        lockStartAt,
        lockEndAt,
        status: "active",
        source: "streamflow",
        lastSyncedAt: now,
      },
    });
  }
}
