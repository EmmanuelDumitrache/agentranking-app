export const METAPLEX_LOGO_SRC = "/branding/metaplex/metaplex-icon.png";
export const METAPLEX_HUB_PATH = "/metaplex";
export const METAPLEX_AGENTS_PATH = "/ranking?metaplex=true";
export function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${encodeURIComponent(address.trim())}`;
}
/** Canonical Metaplex Agent Registry profile page (Core asset pubkey). */
export function metaplexAgentPageUrl(assetAddress: string): string {
  return `https://www.metaplex.com/agents/${encodeURIComponent(assetAddress.trim())}`;
}
