/**
 * Stake site Query Key Factory.
 *
 * Covers server-state resources on `/stake`, served by `StakeQueryProviders`.
 */
export const stakeKeys = {
  all: ["stake"] as const,

  metrics: () => [...stakeKeys.all, "metrics"] as const,

  positions: (wallet: string) => [...stakeKeys.all, "positions", wallet] as const,

  pool: (mintOrPoolAddress: string) =>
    [...stakeKeys.all, "pool", mintOrPoolAddress] as const,

  walletBalances: (owner: string, mint: string) =>
    [...stakeKeys.all, "wallet-balances", owner, mint] as const,
} as const;