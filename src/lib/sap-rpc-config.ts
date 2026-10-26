/**
 * SAP indexer RPC URL resolution — Synapse primary, optional generic Solana fallback.
 * Used only by services/sap-indexer.ts (not ERC-8004 worker or page-load RPC).
 */
export const DEFAULT_SYNAPSE_RPC_URL = "https://us-1-mainnet.oobeprotocol.ai/rpc";
/** Last-resort read-only Solana RPC when Synapse and explicit fallbacks are unavailable. */
export const DEFAULT_SAP_PUBLIC_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
function rpcUrlHasApiKey(url: string): boolean {
  try {
    const u = new URL(url);
    return u.searchParams.has("api_key") || u.searchParams.has("api-key");
  } catch {
    return /[?&]api[_-]?key=/i.test(url);
  }
}
/** Append SYNAPSE_API_KEY as api_key query param when not already present in the URL. */
export function withSynapseApiKey(rpcUrl: string, apiKey?: string): string {
  const key = apiKey?.trim();
  if (!key || rpcUrlHasApiKey(rpcUrl)) return rpcUrl;
  try {
    const u = new URL(rpcUrl);
    u.searchParams.set("api_key", key);
    return u.toString();
  } catch {
    const sep = rpcUrl.includes("?") ? "&" : "?";
    return `${rpcUrl}${sep}api_key=${encodeURIComponent(key)}`;
  }
}
/** Primary Synapse / OOBE RPC for SAP indexing (env SYNAPSE_RPC_URL + optional SYNAPSE_API_KEY). */
export function resolveSapPrimaryRpcUrl(): string {
  const base = (process.env.SYNAPSE_RPC_URL ?? DEFAULT_SYNAPSE_RPC_URL).trim();
  return withSynapseApiKey(base, process.env.SYNAPSE_API_KEY);
}
/** Optional fallback: SAP_RPC_FALLBACK_URL, then SOLANA_RPC_FALLBACK_URL (e.g. Helius). */
export function resolveSapFallbackRpcUrl(): string | null {
  const sap = process.env.SAP_RPC_FALLBACK_URL?.trim();
  if (sap) return sap;
  const sol = process.env.SOLANA_RPC_FALLBACK_URL?.trim();
  return sol || null;
}
/** Log-safe RPC label — origin + pathname only (no query secrets). */
export function redactRpcUrlForLogs(url: string): string {
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
