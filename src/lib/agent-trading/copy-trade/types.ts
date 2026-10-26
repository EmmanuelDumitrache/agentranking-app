export type CopyLeaderboardTrader = {
  rank: number;
  wallet: string;
  label: string | null;
  pnlUsd: number;
  winRate: number;
  volumeUsd: number;
  trades: number;
  venue: "spot";
  chain: "solana";
  topAssetSymbol?: string;
  topAssetIcon?: string;
  profileUrl?: string;
  /** Cumulative PnL points for sparkline (typically ~30d from perp.so). */
  pnlSparkline?: number[];
};

