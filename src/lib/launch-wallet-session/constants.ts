export const LAUNCH_WALLET_SESSION_COOKIE = "ar_launch_wallet_session";

/** Challenge must be signed within this window. */
export const LAUNCH_WALLET_NONCE_TTL_MS = 10 * 60 * 1000;

/** Signed session lifetime after verification. */
export const LAUNCH_WALLET_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** Iron-session seal TTL — must cover session lifetime. */
export const LAUNCH_WALLET_IRON_TTL_SEC = 6 * 60 * 60;

export type LaunchWalletChain = "solana" | "evm";
