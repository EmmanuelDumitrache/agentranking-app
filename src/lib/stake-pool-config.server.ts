import "server-only";
import { getMint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { SolanaStakingClient } from "@streamflow/staking";
import { resolveArSolanaMint, resolveArTokenDecimals } from "@/lib/ar-token-public";
import {
  streamflowICluster,
  streamflowRpcEndpoint,
  streamflowStakePoolDefaults,
  type StreamflowPoolConfigDto,
} from "@/lib/streamflow-stake-config";
async function mintDecimals(connection: Connection, mint: PublicKey): Promise<number | null> {
  try {
    return (await getMint(connection, mint)).decimals;
  } catch {
    return null;
  }
}
export async function readStreamflowPoolConfig(): Promise<StreamflowPoolConfigDto | null> {
  const defaults = streamflowStakePoolDefaults();
  const poolAddress = defaults.stakePool.trim();
  if (!poolAddress) return null;
  const rpcEndpoint = streamflowRpcEndpoint();
  const client = new SolanaStakingClient({
    clusterUrl: rpcEndpoint,
    cluster: streamflowICluster(),
  });
  const pool = await client.getStakePool(new PublicKey(poolAddress));
  const connection = new Connection(rpcEndpoint, "confirmed");
  const underlyingMint = pool.mint;
  const receiptMint = pool.stakeMint;
  let decimals = await mintDecimals(connection, underlyingMint);
  if (decimals == null && underlyingMint.toBase58() === resolveArSolanaMint()) {
    decimals = resolveArTokenDecimals();
  }
  if (decimals == null) decimals = await mintDecimals(connection, receiptMint);
  if (decimals == null) decimals = resolveArTokenDecimals();
  return {
    poolAddress,
    stakeMint: receiptMint.toBase58(),
    underlyingMint: underlyingMint.toBase58(),
    constraints: {
      min: pool.minDuration.toString(),
      max: pool.maxDuration.toString(),
    },
    decimals,
    fetchedAt: new Date().toISOString(),
  };
}
