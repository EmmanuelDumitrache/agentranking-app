/** Minimum agent wallet balance required to register on Solana mainnet. */
export const SOLANA_REGISTRATION_MIN_BALANCE_LAMPORTS = 10_000_000;

/** Shown in UI — network rent + fees, not an AgentRanking platform charge. */
export const SOLANA_REGISTRATION_NETWORK_FEE_LABEL = "~0.01 SOL";

export const SOLANA_REGISTRATION_EXPLORER_CLUSTER = "mainnet-beta" as const;

export function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
}

export function solscanTransactionUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}
