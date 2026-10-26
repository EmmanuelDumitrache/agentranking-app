/** Human-readable Solana network label for UI (server + client safe). */
export function formatLaunchNetworkLabel(network: string): string {
  const normalized = network.trim().toLowerCase();
  if (normalized === "devnet") return "Devnet";
  if (normalized === "mainnet-beta" || normalized === "mainnet") return "Mainnet";
  if (!normalized) return "Unknown";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}