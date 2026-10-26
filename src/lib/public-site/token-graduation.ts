import type { TokenMarketSnapshot } from "@/lib/public-site/dexscreener";
import type { PumpFunBondingData } from "@/lib/public-site/pumpfun-bonding";
import {
  computeRobinhoodGraduationProgress,
  type RobinhoodGraduationMetrics,
} from "@/lib/robinhood-chain/robinhood-graduation";
export type TokenGraduationDisplay = {
  /** 0–100 bonding progress; 100 when graduated / live */
  progressPct: number | null;
  graduated: boolean;
  statusLabel: string;
  detailLabel: string | null;
  showBar: boolean;
};
/** Buyer-supplied SOL needed after Pump.fun's 30 SOL virtual seed (85 total virtual SOL). */
const BONDING_TARGET_SOL = 55;
/** Solana Pump.fun graduation state from live bonding + optional DEX listing. */
export function resolveSolanaGraduation(
  pumpFun: PumpFunBondingData | null,
  market: TokenMarketSnapshot | null,
): TokenGraduationDisplay {
  // Pump.fun `complete` is authoritative when available. DexScreener may list
  // PumpSwap pairs while the token is still on the bonding curve.
  const graduated = pumpFun ? pumpFun.graduated : Boolean(market?.pairAddress);
  const progressPct = graduated
    ? 100
    : pumpFun?.bondingProgressPct ?? null;
  if (!pumpFun && !market?.pairAddress) {
    return {
      progressPct: null,
      graduated: false,
      statusLabel: "Pending",
      detailLabel: null,
      showBar: false,
    };
  }
  if (graduated) {
    return {
      progressPct: 100,
      graduated: true,
      statusLabel: "Graduated",
      detailLabel: market?.pairAddress ? "Live on DEX" : "Migrated from Pump.fun",
      showBar: true,
    };
  }
  if (progressPct == null) {
    return {
      progressPct: 0,
      graduated: false,
      statusLabel: "Bonding",
      detailLabel: null,
      showBar: true,
    };
  }
  const bondedSol = pumpFun?.bondingSol;
  const remainingSol =
    bondedSol != null ? Math.max(0, BONDING_TARGET_SOL - bondedSol) : null;
  return {
    progressPct,
    graduated: false,
    statusLabel: `${progressPct}%`,
    detailLabel:
      bondedSol != null && remainingSol != null
        ? `${bondedSol.toFixed(1)} / ${BONDING_TARGET_SOL} SOL · ${remainingSol.toFixed(1)} left`
        : null,
    showBar: true,
  };
}
/**
 * Quiver V3 has no bonding / graduation curve — tokens are tradeable at deploy
 * with locked Uniswap v3 LP. This display is a liquidity status, not a curve.
 */
export function resolveRobinhoodGraduation(
  poolAddress: string | null | undefined,
  metrics?: RobinhoodGraduationMetrics | null,
): TokenGraduationDisplay {
  if (!poolAddress?.trim()) {
    return {
      progressPct: 0,
      graduated: false,
      statusLabel: "Deploying",
      detailLabel: "Waiting for Quiver pool",
      showBar: true,
    };
  }
  if (!metrics || metrics.source === "quiver" || metrics.bondingTargetEth <= 0) {
    const poolWeth = metrics && metrics.netBuyAmountEth > 0
      ? `${formatEthAmount(metrics.netBuyAmountEth)} WETH liquidity`
      : null;
    return {
      progressPct: 100,
      graduated: true,
      statusLabel: "Live",
      detailLabel: poolWeth
        ? `Uniswap v3 · LP locked · ${poolWeth}`
        : "Uniswap v3 · LP locked at launch",
      showBar: true,
    };
  }
  const { progressPct, graduated, remainingEth } = computeRobinhoodGraduationProgress(metrics);
  const roundedPct = Math.round(progressPct * 10) / 10;
  const netBuy = Math.max(0, metrics.netBuyAmountEth);
  const target = metrics.bondingTargetEth;
  if (graduated) {
    return {
      progressPct: 100,
      graduated: true,
      statusLabel: "Live",
      detailLabel: `${target} ETH target hit`,
      showBar: true,
    };
  }
  return {
    progressPct: roundedPct,
    graduated: false,
    statusLabel: `${roundedPct}%`,
    detailLabel: `${formatEthAmount(netBuy)} / ${formatEthAmount(target)} ETH · ${formatEthAmount(remainingEth)} left`,
    showBar: true,
  };
}
function formatEthAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(2);
  return value.toFixed(3);
}
