export type PublicStakeSummary = {
  generatedAt: string;
  stakingSource: "onchain" | "synced";
  stakingEnabled: boolean;
  poolConfigured: boolean;
  clusterLabel: string;
  totalStakedAr: number | null;
  activeStakers: number | null;
  /** $AR currently in Streamflow reward vaults (funded for stakers). */
  stakingRewardsAr: number | null;
  /** $AR currently in the bonus rewards vault. */
  bonusRewardsVaultAr: number | null;
  buybacksUsd: number | null;
  buybacksAr: number | null;
  buybacksSol: number | null;
  feesToFlywheelUsd: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
};