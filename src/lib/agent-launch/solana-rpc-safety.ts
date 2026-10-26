/**
 * Browser must never call paid/keyed Solana RPCs — keys get burned (429 / max usage).
 * Keep private Helius (and any api-key URL) on the server only.
 */
export function isBrowserUnsafeSolanaRpcUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("api-key=") ||
    lower.includes("helius") ||
    lower.includes("helius-rpc")
  );
}
