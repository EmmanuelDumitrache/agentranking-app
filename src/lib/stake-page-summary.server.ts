import "server-only";
import { readArBuybackSummary } from "@/lib/ar-buyback-summary.server";
import { readArTokenMetricsPayload } from "@/lib/ar-token-admin-data";
import { readArTokenStakingPublicPayload } from "@/lib/ar-token-staking-data";
import { resolveArSolanaMint } from "@/lib/ar-token-public";
import { getDexscreenerMarketForMint } from "@/lib/public-site/dexscreener";
import type { PublicStakeSummary } from "@/lib/public-stake-summary";
import type { StakePageMetricsDto } from "@/lib/stake-page-data";
import {
  publicStreamflowStakePoolAddresses,
  stakingPageSolanaClusterLabel,
} from "@/lib/streamflow-stake-config";
import { readStreamflowPublicSummary } from "@/lib/streamflow-public-summary.server";
const FLYWHEEL_SHARE = 0.8;
export async function readStakePageMetrics(): Promise<StakePageMetricsDto> {
  const metrics = await readArTokenMetricsPayload();
  return { generatedAt: new Date().toISOString(), totals: metrics.totals };
}
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
export async function readPublicStakeSummary(): Promise<PublicStakeSummary> {
  const [staking, flywheel, market] = await Promise.all([
    readArTokenStakingPublicPayload({ flowLimit: 1, rewardLimit: 1 }),
    readArTokenMetricsPayload(),
    getDexscreenerMarketForMint(resolveArSolanaMint()),
  ]);
  // Build-time prerendering must not consume scarce chain RPC quota. The page is ISR and
  // will refresh from live sources after deployment; during `next build`, use the durable
  // synced/database-backed values already loaded above instead of making optional RPC reads.
  const productionBuild = process.env.NEXT_PHASE === "phase-production-build";
  const onChain = productionBuild ? null : await readStreamflowPublicSummary();
  const buybacks = productionBuild
    ? {
        buybacksUsd: 0,
        buybacksAr: 0,
        buybacksSol: 0,
        buybackCount: 0,
        source: "unavailable" as const,
        readAt: new Date().toISOString(),
      }
    : await readArBuybackSummary();
  let buybacksUsdFromOps: number | null = null;
  if (buybacks.source === "ops-wallet") {
    if (buybacks.buybacksUsd > 0) {
      buybacksUsdFromOps = buybacks.buybacksUsd;
    } else if (buybacks.buybacksAr > 0 && market?.priceUsd != null && market.priceUsd > 0) {
      buybacksUsdFromOps = buybacks.buybacksAr * market.priceUsd;
    }
  }
  const buybacksUsd = buybacksUsdFromOps ?? finiteOrNull(flywheel.totals.totalBuybackUsd);
  return {
    generatedAt: new Date().toISOString(),
    stakingSource: onChain ? "onchain" : "synced",
    stakingEnabled: staking.settings.stakingEnabled,
    poolConfigured: publicStreamflowStakePoolAddresses().length > 0,
    clusterLabel: stakingPageSolanaClusterLabel(),
    totalStakedAr: finiteOrNull(onChain?.totalStakedAr ?? staking.totals.stakedSupplyToken),
    activeStakers: finiteOrNull(onChain?.activeStakers ?? staking.totals.activeStakers),
    stakingRewardsAr: finiteOrNull(
      onChain?.stakingRewardsAr ?? staking.totals.stakingRewardsToken,
    ),
    bonusRewardsVaultAr: finiteOrNull(onChain?.bonusRewardsVaultAr ?? 0),
    buybacksUsd,
    buybacksAr: finiteOrNull(buybacks.buybacksAr),
    buybacksSol: finiteOrNull(buybacks.buybacksSol),
    feesToFlywheelUsd: finiteOrNull(flywheel.totals.totalRevenueUsd * FLYWHEEL_SHARE),
    priceUsd: market?.priceUsd ?? null,
    marketCapUsd: market?.marketCapUsd ?? market?.fdvUsd ?? null,
  };
}
