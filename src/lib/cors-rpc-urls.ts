/**
 * Browser-safe HTTP RPC endpoints (CORS-enabled).
 * Avoid rpc.sepolia.org, eth.llamarpc.com, and other endpoints that 404 or block preflight.
 */
export const SEPOLIA_BROWSER_RPC_URLS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://1rpc.io/sepolia",
] as const;
export const MAINNET_BROWSER_RPC_URLS = [
  "https://eth.merkle.io",
  "https://ethereum-rpc.publicnode.com",
  "https://cloudflare-eth.com",
] as const;
export const BASE_SEPOLIA_BROWSER_RPC_URLS = [
  "https://sepolia.base.org",
  "https://base-sepolia-rpc.publicnode.com",
] as const;
/** Server-side Sepolia reads — prefer reliable public endpoints over quota-limited Infura. */
export const SEPOLIA_SERVER_RPC_URLS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://1rpc.io/sepolia",
] as const;