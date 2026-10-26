import "server-only";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import {
  parseAgentLaunchNetwork,
  resolveAgentLaunchRpcUrl,
  validateAgentLaunchRpcEnv,
  type AgentLaunchNetwork,
} from "@/lib/agent-launch/network";
const MAINNET_PUBLIC_READ_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://g.w.lavanet.xyz/gateway/solana/rpc-http/d0bb489e58484729b8636c38efc610f3",
] as const;
export const SOLANA_RPC_BUSY_MESSAGE =
  "Solana RPC is rate-limited right now. Wait about 30 seconds and refresh — your registration may already be on-chain.";

export function isSolanaRpcRateLimitedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b429\b|too many requests|max usage reached|rate.?limit|connection rate limits|-32429/i.test(
    message,
  );
}
function resolveAgentLaunchBalanceRpcCandidates(network: AgentLaunchNetwork): string[] {
  const primary = resolveAgentLaunchRpcUrl(network);
  const publicFallbacks = network === "mainnet-beta"
    ? [clusterApiUrl("mainnet-beta"), ...MAINNET_PUBLIC_READ_FALLBACKS]
    : [clusterApiUrl("devnet")];
  return [...new Set([primary, ...publicFallbacks].filter(Boolean))];
}

export function getAgentLaunchNetwork(): AgentLaunchNetwork {
  const config = getAgentLaunchConfig();
  return parseAgentLaunchNetwork(config.network);
}
export function resolveAgentLaunchDevnetRpcUrl(): string {
  return resolveAgentLaunchRpcUrl("devnet");
}
export function getAgentLaunchConnection(): Connection {
  const network = getAgentLaunchNetwork();
  return new Connection(resolveAgentLaunchRpcUrl(network), "confirmed");
}
/** Public cluster RPC used only as a read fallback when the primary RPC fails (e.g. 429). */
export function resolveAgentLaunchPublicFallbackRpcUrl(
  network: AgentLaunchNetwork = getAgentLaunchNetwork(),
): string {
  return network === "devnet" ? clusterApiUrl("devnet") : clusterApiUrl("mainnet-beta");
}
/**
 * Read SOL balance via primary Agent Launch RPC, then public RPCs on failure.
 * Keeps prepare/funding working when a paid Helius key is rate-limited (429 / max usage).
 */
export async function withAgentLaunchReadRpc<T>(
  fn: (connection: Connection) => Promise<T>,
): Promise<T> {
  const network = getAgentLaunchNetwork();
  const candidates = resolveAgentLaunchBalanceRpcCandidates(network);
  let lastError: unknown;
  for (const url of candidates) {
    const connection = new Connection(url, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
    try {
      return await fn(connection);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("RPC read failed from all candidates");
}
export async function getAgentLaunchSolBalanceLamports(publicKey: PublicKey): Promise<number> {
  const network = getAgentLaunchNetwork();
  const candidates = resolveAgentLaunchBalanceRpcCandidates(network);
  let lastError: unknown;
  for (const url of candidates) {
    const connection = new Connection(url, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
    try {
      return await connection.getBalance(publicKey);
    } catch (error) {
      lastError = error;
      if (!isSolanaRpcRateLimitedError(error) && url === candidates[0]) {
        // Non-rate-limit on primary: still try fallbacks (transient RPC outages).
      }
      console.warn(
        "[agent-launch] RPC balance failed; trying next candidate",
        error instanceof Error ? error.message : error,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to read SOL balance from all RPC candidates");
}
/**
 * Latest blockhash via private server RPC + public fallbacks.
 * Keeps browser clients off burned/rate-limited public Helius keys.
 */
export async function getAgentLaunchLatestBlockhash(network: AgentLaunchNetwork): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const primaryUrl = resolveAgentLaunchRpcUrl(network);
  const fallbacks =
    network === "mainnet-beta"
      ? [clusterApiUrl("mainnet-beta"), ...MAINNET_PUBLIC_READ_FALLBACKS]
      : [clusterApiUrl("devnet")];
  const candidates = [...new Set([primaryUrl, ...fallbacks].filter(Boolean))];
  let lastError: unknown;
  for (const rpcUrl of candidates) {
    try {
      const connection = new Connection(rpcUrl, {
        commitment: "confirmed",
        disableRetryOnRateLimit: true,
      });
      return await connection.getLatestBlockhash("confirmed");
    } catch (error) {
      lastError = error;
      console.warn(
        "[agent-launch] RPC latestBlockhash failed; trying next candidate",
        error instanceof Error ? error.message : error,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch latest blockhash from all RPC candidates");
}
export function assertAgentLaunchChainConfig(): {
  treasury: string;
  rpcUrl: string;
  network: AgentLaunchNetwork;
} {
  const config = getAgentLaunchConfig();
  const network = parseAgentLaunchNetwork(config.network);
  const rpcError = validateAgentLaunchRpcEnv(network);
  if (rpcError) {
    throw new Error(rpcError);
  }
  if (!config.treasury) {
    throw new Error("AgentRanking fee recipient wallet is not configured");
  }
  return {
    treasury: config.treasury,
    rpcUrl: resolveAgentLaunchRpcUrl(network),
    network,
  };
}
