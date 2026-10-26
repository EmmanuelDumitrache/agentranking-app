import { clusterApiUrl } from "@solana/web3.js";
export const AGENT_LAUNCH_NETWORKS = ["devnet", "mainnet-beta"] as const;
export type AgentLaunchNetwork = (typeof AGENT_LAUNCH_NETWORKS)[number];
export function normalizeAgentLaunchNetwork(raw: string): AgentLaunchNetwork | null {
  const n = raw.trim().toLowerCase();
  if (n === "devnet") return "devnet";
  if (n === "mainnet-beta" || n === "mainnet") return "mainnet-beta";
  return null;
}
export function parseAgentLaunchNetwork(raw?: string | null): AgentLaunchNetwork {
  const normalized = normalizeAgentLaunchNetwork(raw?.trim() || "devnet");
  if (!normalized) {
    throw new Error(
      `Unsupported AGENT_LAUNCH_NETWORK "${raw}". Use devnet or mainnet-beta.`,
    );
  }
  return normalized;
}
export function isAgentLaunchNetwork(value: string): value is AgentLaunchNetwork {
  return normalizeAgentLaunchNetwork(value) != null;
}
export function resolveAgentLaunchRpcUrl(network: AgentLaunchNetwork): string {
  if (network === "devnet") {
    return (
      process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL?.trim() ||
      clusterApiUrl("devnet")
    );
  }
  return (
    process.env.AGENT_LAUNCH_MAINNET_RPC_URL?.trim() ||
    process.env.SOLANA_MAINNET_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.HELIUS_RPC_URL?.trim() ||
    clusterApiUrl("mainnet-beta")
  );
}
/** Fail closed in production mainnet when only the public RPC default would be used. */
export function validateAgentLaunchRpcEnv(network: AgentLaunchNetwork): string | null {
  if (network === "devnet") return null;
  const explicit =
    process.env.AGENT_LAUNCH_MAINNET_RPC_URL?.trim() ||
    process.env.SOLANA_MAINNET_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.HELIUS_RPC_URL?.trim();
  if (!explicit) {
    return "AGENT_LAUNCH_MAINNET_RPC_URL (or SOLANA_MAINNET_RPC_URL / SOLANA_RPC_URL / HELIUS_RPC_URL) is required for mainnet-beta Agent Launch";
  }
  const devnetLeak =
    process.env.SOLANA_DEVNET_RPC_URL?.trim() &&
    explicit === process.env.SOLANA_DEVNET_RPC_URL.trim();
  if (devnetLeak) {
    return "Mainnet launch cannot use SOLANA_DEVNET_RPC_URL as the primary RPC";
  }
  return null;
}
export function solanaExplorerClusterParam(network: AgentLaunchNetwork): string | undefined {
  return network === "devnet" ? "devnet" : undefined;
}