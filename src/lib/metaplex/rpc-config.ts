/**
 * Metaplex indexer RPC URL resolution.
 * Prefers METAPLEX_RPC_URL, then SOLANA_RPC_FALLBACK_URL, then NEXT_PUBLIC_SOLANA_RPC.
 */
const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
/** True when an explicit RPC URL env var is set (not the public mainnet default). */
export function isExplicitMetaplexRpcConfigured(): boolean {
  return Boolean(
    process.env.METAPLEX_RPC_URL?.trim() ||
      process.env.SOLANA_RPC_FALLBACK_URL?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_RPC?.trim(),
  );
}
export function isHeliusApiKeyConfigured(): boolean {
  return Boolean(process.env.HELIUS_API_KEY?.trim());
}
export function resolveMetaplexRpcUrl(): string {
  const dedicated = process.env.METAPLEX_RPC_URL?.trim();
  if (dedicated) return dedicated;
  const fallback = process.env.SOLANA_RPC_FALLBACK_URL?.trim();
  if (fallback) return fallback;
  const publicRpc = process.env.NEXT_PUBLIC_SOLANA_RPC?.trim();
  if (publicRpc) return publicRpc;
  const heliusKey = process.env.HELIUS_API_KEY?.trim();
  if (heliusKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`;
  }
  return DEFAULT_MAINNET_RPC;
}
/** Log-safe RPC label — origin + pathname only (no query secrets). */
export function redactMetaplexRpcUrlForLogs(url: string): string {
  try {
    const value = new URL(url);
    value.username = "";
    value.password = "";
    value.search = "";
    value.hash = "";
    const parts = value.pathname.split("/").filter(Boolean);
    if (parts.length > 0 && /^[A-Za-z0-9_-]{20,}$/.test(parts.at(-1) ?? "")) {
      parts[parts.length - 1] = "[redacted]";
      value.pathname = `/${parts.join("/")}`;
    }
    return `${value.origin}${value.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}
