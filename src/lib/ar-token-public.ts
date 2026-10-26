/**
 * Canonical live $AR (AgentRanking) Solana token — official mint and market links.
 * Env vars override for staging; production falls back here when unset.
 */
export const AR_SOLANA_MINT = "92eXvBFGBAXwgmPf6t6CUCNJH2xChsCJuWzaGPjyPUmP" as const;
/** Official DexScreener pair page (PumpSwap primary liquidity). */
export const AR_DEXSCREENER_URL =
  "https://dexscreener.com/solana/92exvbfgbaxwgmpf6t6cucnjh2xchscjuwzagpjypump" as const;
export const AR_PUMPFUN_URL = `https://pump.fun/coin/${AR_SOLANA_MINT}` as const;
export const AR_SOLSCAN_TOKEN_URL = `https://solscan.io/token/${AR_SOLANA_MINT}` as const;
/** Primary PumpSwap pair on DexScreener (higher liquidity than bonding curve). */
export const AR_DEX_PAIR_ADDRESS = "6VZdd6LsKTbex42xHLW85nEJtkE2ePgka2WsQu4tbo4F" as const;
export const AR_TOKEN_DECIMALS = 6 as const;
export const AR_SOLANA_CLUSTER = "mainnet-beta" as const;
export const AR_LAUNCH_STATUS = "launched" as const;
/** Ops wallet used for manual buybacks and burns shown on Live Stats. */
export const AR_OPS_WALLET = "J5QG8T3vqCSmFhE92VBwtHCQnAphzZynZAccBCP8iqqc" as const;
/** Solana incinerator — SPL burns sent here reduce circulating supply. */
export const SOLANA_INCINERATOR = "1nc1nerator11111111111111111111111111111111111" as const;
export function resolveArOpsWallet(): string {
  const env = process.env.AR_OPS_WALLET?.trim() || process.env.NEXT_PUBLIC_AR_OPS_WALLET?.trim();
  if (env && env.length >= 32) return env;
  return AR_OPS_WALLET;
}
export function isValidSolanaMintAddress(value: string): boolean {
  const v = value.trim();
  return v.length >= 32 && v.length <= 44 && v.toUpperCase() !== "TBA";
}
export function resolveArSolanaMint(): string {
  const env = process.env.NEXT_PUBLIC_AR_SOLANA_MINT?.trim();
  if (env && isValidSolanaMintAddress(env)) return env;
  return AR_SOLANA_MINT;
}
export function resolveArDexScreenerUrl(): string {
  const env = process.env.NEXT_PUBLIC_AR_DEXSCREENER_URL?.trim();
  if (env?.startsWith("http")) return env;
  return AR_DEXSCREENER_URL;
}
export function resolveArPumpFunUrl(): string {
  const env = process.env.NEXT_PUBLIC_AR_PUMPFUN_URL?.trim();
  if (env?.startsWith("http")) return env;
  return AR_PUMPFUN_URL;
}
export function resolveArSolscanTokenUrl(): string {
  const env = process.env.NEXT_PUBLIC_AR_SOLSCAN_MINT_URL?.trim();
  if (env?.startsWith("http")) return env;
  return AR_SOLSCAN_TOKEN_URL;
}
export function resolveArTokenDecimals(): number {
  const env = process.env.NEXT_PUBLIC_AR_TOKEN_DECIMALS?.trim();
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 18) return n;
  }
  return AR_TOKEN_DECIMALS;
}

export function resolveArSolanaClusterHint(): string {
  const env = process.env.NEXT_PUBLIC_AR_SOLANA_CLUSTER?.trim();
  return env?.length ? env : AR_SOLANA_CLUSTER;
}
