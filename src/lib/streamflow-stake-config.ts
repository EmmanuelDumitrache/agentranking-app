import { clusterApiUrl } from "@solana/web3.js";
import { ICluster } from "@streamflow/common";
import { resolveArSolanaMint } from "@/lib/ar-token-public";
export type StreamflowPoolConfigDto = Readonly<{
  poolAddress: string;
  stakeMint: string;
  underlyingMint: string;
  constraints: Readonly<{ min: string; max: string }>;
  decimals: number;
  fetchedAt: string;
}>;
/** Production $AR stake pool on Streamflow mainnet (override via env if needed). */
export const DEFAULT_STREAMFLOW_STAKE_POOL = "Dx2XPveijG6n3UpM3kEB4ZcYLZvSzrJLiCBMER36Xe6S" as const;
/**
 * Streamflow stake *receipt* mint for `DEFAULT_STREAMFLOW_STAKE_POOL` (`pool.stakeMint`).
 * Used for allowlist / env identity — not the mint debited when staking.
 * Stake txs must use `getStakePool().mint` (underlying $AR).
 */
export const DEFAULT_STREAMFLOW_STAKE_POOL_MINT = "5BiP6MEkhsLX538aPdpjaHNMg3Yqxb9eznR7AzhFekt7" as const;
export function streamflowStakePoolDefaults(): { stakePool: string; stakePoolMint: string } {
  return {
    stakePool:
      process.env.NEXT_PUBLIC_STREAMFLOW_STAKE_POOL?.trim() || DEFAULT_STREAMFLOW_STAKE_POOL,
    stakePoolMint:
      process.env.NEXT_PUBLIC_STREAMFLOW_STAKE_POOL_MINT?.trim() ||
      DEFAULT_STREAMFLOW_STAKE_POOL_MINT,
  };
}
/** Prefer `NEXT_PUBLIC_SOLANA_NETWORK`, then `NEXT_PUBLIC_AR_SOLANA_CLUSTER`, else mainnet go-live default. */
export function resolveStreamflowSolanaNetwork(): string {
  const net =
    process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim().toLowerCase() ||
    process.env.NEXT_PUBLIC_AR_SOLANA_CLUSTER?.trim().toLowerCase();
  if (!net) return "mainnet-beta";
  return net;
}
export function streamflowRpcEndpoint(): string {
  const direct =
    process.env.NEXT_PUBLIC_SOLANA_RPC?.trim() || process.env.NEXT_PUBLIC_AR_SOLANA_RPC_URL?.trim();
  if (direct) return direct;
  return streamflowPublicClusterRpcEndpoint();
}
/** Public cluster RPC for homepage/metrics reads. The keyed Helius endpoint times out from the VPS. */
export function streamflowPublicClusterRpcEndpoint(): string {
  const net = resolveStreamflowSolanaNetwork();
  if (net === "mainnet-beta" || net === "mainnet") return clusterApiUrl("mainnet-beta");
  if (net === "testnet") return clusterApiUrl("testnet");
  return clusterApiUrl("devnet");
}
export function streamflowICluster(): ICluster {
  const net = resolveStreamflowSolanaNetwork();
  if (net === "mainnet-beta" || net === "mainnet") return ICluster.Mainnet;
  if (net === "testnet") return ICluster.Testnet;
  return ICluster.Devnet;
}
/** Human-readable Solana cluster for staking UI (matches `streamflowICluster` / env). */
export function stakingPageSolanaClusterLabel(): string {
  const net = resolveStreamflowSolanaNetwork();
  if (net === "mainnet-beta" || net === "mainnet") return "Mainnet";
  if (net === "testnet") return "Testnet";
  if (net === "devnet") return "Devnet";
  return net;
}
export function solanaExplorerTxUrl(signature: string): string {
  const net = resolveStreamflowSolanaNetwork();
  let cluster = "?cluster=devnet";
  if (net === "mainnet-beta" || net === "mainnet") cluster = "";
  else if (net === "testnet") cluster = "?cluster=testnet";
  return `https://solscan.io/tx/${signature.trim()}${cluster}`;
}
/** Official $AR lock-tier pools used for public aggregate staking metrics. */
export const DEFAULT_PUBLIC_STREAMFLOW_STAKE_POOLS = [
  "53AJ6WCBy1nRsxD4sVgwcp9WJp5touTBj3nhpe1ZcBKa", // 7 days
  "5dNpPLZdmpGT1htDm3x45bAeTWpqyuZE7zLcM6piSKPC", // 30 days
  "EbGkrgtrcPTcXe3ATgrZUm9yEG8XHRPzyqFFyEsvYdVh", // 90 days
  "HHLhtB4EpqebCbpw1X3DZjfQMK4Erdj5VKXeWfNzUSR9", // 180 days
] as const;
export function publicStreamflowStakePoolAddresses(): string[] {
  const configured = process.env.NEXT_PUBLIC_STREAMFLOW_STAKE_POOLS
    ?.split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  return configured?.length
    ? [...new Set(configured)]
    : [...DEFAULT_PUBLIC_STREAMFLOW_STAKE_POOLS];
}
/**
 * `ar-staking-bonus-rewards-vault1.sol` — holds $AR dripped into Streamflow reward pools.
 * https://solscan.io/account/HkiQhgVnmFepz6pcdnuF5iKUqDnqJpXiLTi3wKePxxDq
 */
export const DEFAULT_AR_BONUS_REWARDS_VAULT =
  "HkiQhgVnmFepz6pcdnuF5iKUqDnqJpXiLTi3wKePxxDq" as const;
/**
 * Streamflow reward-vault authorities that receive `fund_pool` drips from the bonus vault
 * (one per lock tier: 7d / 30d / 90d / 180d).
 */
export const DEFAULT_STREAMFLOW_REWARD_VAULT_OWNERS = [
  "4GEbnR6nXCovZkEzzZtVVDZ3dmTLPnztpg2fTUkymfuk", // 7d
  "2p1tc6xYfaFCAGLv2GobEiCZXoXvz37t1yNexAKKFoJ7", // 30d
  "6rqabUFuJgg3oC7CbUSNsSPuyA7mNe9a3HtUAdTgYMfM", // 90d
  "4vd2Keq9XbJCVANMK1GAVDoTgqXqtJd81xbqGhhGpjpB", // 180d
] as const;
export function resolveArBonusRewardsVault(): string {
  const env = process.env.NEXT_PUBLIC_AR_BONUS_REWARDS_VAULT?.trim();
  return env && env.length >= 32 ? env : DEFAULT_AR_BONUS_REWARDS_VAULT;
}
export function streamflowRewardVaultOwners(): string[] {
  const configured = process.env.NEXT_PUBLIC_STREAMFLOW_REWARD_VAULT_OWNERS
    ?.split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  return configured?.length
    ? [...new Set(configured)]
    : [...DEFAULT_STREAMFLOW_REWARD_VAULT_OWNERS];
}
export function allowedStreamflowStakePools(): { poolAddress: string; mintAddress: string } | null {
  const { stakePool, stakePoolMint } = streamflowStakePoolDefaults();
  const poolAddress = stakePool.trim();
  const mintAddress = stakePoolMint.trim();
  if (!poolAddress || !mintAddress) return null;
  return { poolAddress, mintAddress };
}
/** Lowest nonce 0–255 not present in `used` (each nonce = one stake entry per wallet per pool). */
export function firstFreeStakeNonce(used: readonly number[]): number | null {
  const taken = new Set(used);
  for (let nonce = 0; nonce < 256; nonce++) {
    if (!taken.has(nonce)) return nonce;
  }
  return null;
}
export function isAllowlistedStakePool(poolAddress: string, mintAddress: string): boolean {
  const allowed = allowedStreamflowStakePools();
  if (!allowed) return false;
  if (poolAddress.trim() !== allowed.poolAddress) return false;
  const m = mintAddress.trim();
  const underlying = resolveArSolanaMint().trim();
  return m === allowed.mintAddress || (underlying.length > 0 && m === underlying);
}
