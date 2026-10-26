import { solanaExplorerClusterParam, type AgentLaunchNetwork } from "@/lib/agent-launch/network";
function explorerUrl(path: string, network: AgentLaunchNetwork): string {
  const cluster = solanaExplorerClusterParam(network);
  const suffix = cluster ? `?cluster=${cluster}` : "";
  return `https://explorer.solana.com/${path}${suffix}`;
}
export function launchTxExplorerUrl(signature: string, network: AgentLaunchNetwork): string {
  return explorerUrl(`tx/${encodeURIComponent(signature)}`, network);
}
export function launchAddressExplorerUrl(address: string, network: AgentLaunchNetwork): string {
  return explorerUrl(`address/${encodeURIComponent(address)}`, network);
}
export function shortenSolanaAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
export function getPumpFunUrl(mint: string): string {
  return `https://pump.fun/coin/${encodeURIComponent(mint.trim())}`;
}
export function getDexscreenerUrl(mint: string): string {
  return `https://dexscreener.com/solana/${encodeURIComponent(mint.trim())}`;
}
export function getSolscanTokenUrl(mint: string, network: string): string {
  const base = `https://solscan.io/token/${encodeURIComponent(mint.trim())}`;
  if (network === "devnet") return `${base}?cluster=devnet`;
  if (network === "testnet") return `${base}?cluster=testnet`;
  return base;
}