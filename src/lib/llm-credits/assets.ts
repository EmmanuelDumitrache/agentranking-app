import type { SupportedDepositAsset } from "./types";
export const SUPPORTED_ASSETS = ["SOL", "USDC"] as const;
export const ASSET_DECIMALS: Record<SupportedDepositAsset, number> = {
  SOL: 9,
  USDC: 6,
};
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export function getAssetDecimals(asset: SupportedDepositAsset): number {
  return ASSET_DECIMALS[asset];
}
export function isSupportedAsset(s: string): s is SupportedDepositAsset {
  return SUPPORTED_ASSETS.includes(s as SupportedDepositAsset);
}
export function getUsdcMint(network: string): string {
  const isDevnet = network === "devnet" || network === "devnet-beta";
  return isDevnet ? USDC_MINT_DEVNET : USDC_MINT_MAINNET;
}