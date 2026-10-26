import { clusterApiUrl } from "@solana/web3.js";
/** Server-safe Solana RPC URL resolver (no "use client" dependency). */
export function resolveSolanaRpcUrl(): string {
  const explicit = process.env.SOLANA_RPC_URL?.trim();
  if (explicit) return explicit;
  const publicDevnet = process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL?.trim();
  if (publicDevnet) return publicDevnet;
  const network = process.env.SOLANA_NETWORK?.trim().toLowerCase() || "devnet";
  if (network === "mainnet-beta" || network === "mainnet") {
    return clusterApiUrl("mainnet-beta");
  }
  return clusterApiUrl("devnet");
}