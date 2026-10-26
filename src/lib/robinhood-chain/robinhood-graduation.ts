/** Quiver V3 launches are live on Uniswap from creation (locked LP) — no bonding curve. */
export const ROBINHOOD_BONDING_TARGET_ETH = 0;
export type RobinhoodGraduationMetrics = {
  /** Pool WETH balance used as a soft liquidity signal (not a bonding curve). */
  netBuyAmountEth: number;
  athNetBuyAmountEth: number;
  bondingTargetEth: number;
  source: "quiver" | "pool_weth";
};
/**
 * Quiver V3: any launch with a pool is graduated (100%).
 * Legacy metrics with a positive bonding target keep the old progress formula.
 */
export function computeRobinhoodGraduationProgress(
  metrics: RobinhoodGraduationMetrics,
): {
  progressPct: number;
  graduated: boolean;
  remainingEth: number;
} {
  if (metrics.source === "quiver" || metrics.bondingTargetEth <= 0) {
    return { progressPct: 100, graduated: true, remainingEth: 0 };
  }
  const target = metrics.bondingTargetEth;
  const netBuy = Math.max(0, metrics.netBuyAmountEth);
  const athNetBuy = Math.max(0, metrics.athNetBuyAmountEth);
  const graduated = athNetBuy >= target;
  const progressPct = graduated ? 100 : Math.min((netBuy / target) * 100, 100);
  const remainingEth = graduated ? 0 : Math.max(0, target - netBuy);
  return { progressPct, graduated, remainingEth };
}
