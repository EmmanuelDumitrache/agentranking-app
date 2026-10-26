import { solscanAccountUrl } from "@/lib/metaplex/urls";
export function solscanAccountUrlForNetwork(address: string, network: string): string {
  const trimmed = address.trim();
  const base = solscanAccountUrl(trimmed);
  if (network === "devnet") {
    return `${base}?cluster=devnet`;
  }
  if (network === "testnet") {
    return `${base}?cluster=testnet`;
  }
  return base;
}
export function shortenSolanaAddress(value: string, chars = 4): string {
  if (value.length <= chars * 2 + 1) return value;
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}