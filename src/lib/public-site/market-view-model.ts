/**
 * Normalized market view model for the public token detail page.
 *
 * Four market modes: "dex" | "bonding" | "devnet" | "unknown"
 * The UI adapts based on `mode`. All display values come from this view model
 * so components never sprinkle DexScreener/Pump.fun logic inline.
 */
import type { TokenMarketSnapshot } from "./dexscreener";
import type { PumpFunBondingData } from "./pumpfun-bonding";
import {
  resolveRobinhoodGraduation,
  resolveSolanaGraduation,
  type TokenGraduationDisplay,
} from "./token-graduation";
import type { RobinhoodGraduationMetrics } from "@/lib/robinhood-chain/robinhood-graduation";
import { robinhoodExplorerAddressUrl } from "@/lib/robinhood-chain/config";
export type PublicTokenMarketMode = "dex" | "bonding" | "devnet" | "unknown";
export type PublicTokenMarketViewModel = {
  mode: PublicTokenMarketMode;
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  liquidityDisplay: string;
  liquiditySub: string | null;
  /** Estimated USD value of bonded liquidity (bonding mode only). */
  liquidityUsdEstimate: number | null;
  priceSub: string | null;
  volumeSub: string | null;
  /** Whether 24h volume should display as $0 rather than — (bonding mode). */
  volumeIsZero: boolean;
  bondedSol: number | null;
  bondingTargetSol: number;
  bondingProgressPct: number | null;
  graduated: boolean;
  graduationLabel: string | null;
  graduation: TokenGraduationDisplay;
  dexPairUrl: string | null;
  pumpFunUrl: string | null;
  solscanUrl: string | null;
  /** DexScreener embed path segment (pair address or mint). */
  chartEmbedId: string | null;
  /** DexScreener chain slug for embed iframe (`solana` | `robinhood`). */
  chartChainSlug: "solana" | "robinhood" | null;
  sourceLabel: string;
  chartTitle: string;
  chartDescription: string | null;
};
const BONDING_TARGET_SOL = 85;
export function resolveMarketViewModel(params: {
  isMainnet: boolean;
  mint: string | null;
  market: TokenMarketSnapshot | null;
  pumpFun: PumpFunBondingData | null;
}): PublicTokenMarketViewModel {
  const { isMainnet, mint, market, pumpFun } = params;
  const m = mint ?? "";
  const pumpUrl = m ? `https://pump.fun/coin/${encodeURIComponent(m)}` : null;
  const graduation = resolveSolanaGraduation(pumpFun, market);
  const onBondingCurve = pumpFun != null && !pumpFun.graduated;
  if (!isMainnet) {
    return {
      mode: "devnet",
      priceUsd: null,
      marketCapUsd: null,
      volume24hUsd: null,
      liquidityDisplay: "—",
      liquiditySub: null,
      liquidityUsdEstimate: null,
      priceSub: "Devnet",
      volumeSub: "Devnet",
      volumeIsZero: false,
      bondedSol: null,
      bondingTargetSol: BONDING_TARGET_SOL,
      bondingProgressPct: null,
      graduated: false,
      graduationLabel: null,
      graduation: {
        progressPct: null,
        graduated: false,
        statusLabel: "—",
        detailLabel: null,
        showBar: false,
      },
      dexPairUrl: null,
      pumpFunUrl: null,
      solscanUrl: m ? `https://solscan.io/token/${m}?cluster=devnet` : null,
      chartEmbedId: null,
      chartChainSlug: null,
      sourceLabel: "Devnet",
      chartTitle: "Devnet token",
      chartDescription: "Market data is only available for mainnet launches.",
    };
  }
  if (market?.pairAddress && !onBondingCurve) {
    return {
      mode: "dex",
      priceUsd: market.priceUsd,
      marketCapUsd: market.marketCapUsd ?? market.fdvUsd,
      volume24hUsd: market.volume24hUsd,
      liquidityDisplay:
        market.liquidityUsd != null
          ? `$${market.liquidityUsd.toLocaleString("en-US")}`
          : "—",
      liquiditySub: null,
      liquidityUsdEstimate: null,
      priceSub:
        market.priceChange24hPct != null
          ? `${market.priceChange24hPct >= 0 ? "+" : ""}${market.priceChange24hPct.toFixed(2)}% 24h`
          : "DexScreener",
      volumeSub: market.volume24hUsd != null ? "24h DEX volume" : null,
      volumeIsZero: false,
      bondedSol: null,
      bondingTargetSol: BONDING_TARGET_SOL,
      bondingProgressPct: graduation.progressPct,
      graduated: graduation.graduated,
      graduationLabel: graduation.graduated ? graduation.statusLabel : null,
      graduation,
      dexPairUrl: market.pairUrl,
      pumpFunUrl: market.pairUrl ? null : pumpUrl,
      solscanUrl: m ? `https://solscan.io/token/${m}` : null,
      chartEmbedId: market.pairAddress,
      chartChainSlug: "solana",
      sourceLabel: "DexScreener",
      chartTitle: "Market",
      chartDescription: null,
    };
  }
  if (pumpFun) {
    const bondedSol = pumpFun.bondingSol;
    const totalVirtualSol = pumpFun.totalVirtualSol;
    const solPrice = pumpFun.solPriceUsd;
    const liquidityUsdEstimate =
      totalVirtualSol != null && solPrice != null ? totalVirtualSol * solPrice : null;
    const liquidityUsdStr =
      liquidityUsdEstimate != null
        ? `$${Math.round(liquidityUsdEstimate).toLocaleString("en-US")}`
        : totalVirtualSol != null
          ? `${totalVirtualSol.toFixed(2)} SOL total`
          : "Bonding data unavailable";
    return {
      mode: "bonding",
      priceUsd: pumpFun.priceUsd,
      marketCapUsd: pumpFun.marketCapUsd,
      volume24hUsd: null,
      liquidityDisplay: liquidityUsdStr,
      liquiditySub:
        totalVirtualSol != null
          ? bondedSol != null && bondedSol > 0
            ? `${totalVirtualSol.toFixed(2)} SOL total (${bondedSol.toFixed(2)} bonded)`
            : `${totalVirtualSol.toFixed(2)} SOL total`
          : null,
      liquidityUsdEstimate,
      priceSub: "Bonding curve",
      volumeSub: "No trade index yet",
      volumeIsZero: true,
      bondedSol,
      bondingTargetSol: BONDING_TARGET_SOL,
      bondingProgressPct: graduation.progressPct,
      graduated: graduation.graduated,
      graduationLabel: graduation.statusLabel,
      graduation,
      dexPairUrl: m ? `https://dexscreener.com/solana/${encodeURIComponent(m)}` : null,
      pumpFunUrl: pumpUrl,
      solscanUrl: m ? `https://solscan.io/token/${m}` : null,
      chartEmbedId: null,
      chartChainSlug: null,
      sourceLabel: "Pump.fun",
      chartTitle: pumpFun.graduated ? "Graduated" : "Market",
      chartDescription: pumpFun.graduated
        ? "This token has graduated to Raydium."
        : "This token is still trading on Pump.fun. A DEX chart will appear after migration.",
    };
  }
  return {
    mode: "unknown",
    priceUsd: null,
    marketCapUsd: null,
    volume24hUsd: null,
    liquidityDisplay: "—",
    liquiditySub: null,
    liquidityUsdEstimate: null,
    priceSub: null,
    volumeSub: null,
    volumeIsZero: false,
    bondedSol: null,
    bondingTargetSol: BONDING_TARGET_SOL,
    bondingProgressPct: graduation.progressPct,
    graduated: graduation.graduated,
    graduationLabel: graduation.statusLabel,
    graduation,
    dexPairUrl: m ? `https://dexscreener.com/solana/${encodeURIComponent(m)}` : null,
    pumpFunUrl: pumpUrl,
    solscanUrl: m ? `https://solscan.io/token/${m}` : null,
    chartEmbedId: null,
    chartChainSlug: null,
    sourceLabel: "Unavailable",
    chartTitle: "Market data unavailable",
    chartDescription: "Market data has not been indexed for this token yet.",
  };
}
/** Robinhood Chain market view — DexScreener + Quiver graduation (live Uniswap v3). */
export function resolveRobinhoodMarketViewModel(params: {
  tokenAddress: string;
  poolAddress?: string | null;
  market: TokenMarketSnapshot | null;
  graduationMetrics?: RobinhoodGraduationMetrics | null;
}): PublicTokenMarketViewModel {
  const { tokenAddress, poolAddress, market, graduationMetrics } = params;
  const graduation = resolveRobinhoodGraduation(poolAddress, graduationMetrics);
  const searchUrl = `https://dexscreener.com/robinhood/${encodeURIComponent(tokenAddress)}`;
  const explorerUrl = robinhoodExplorerAddressUrl(tokenAddress);
  if (market?.pairAddress) {
    return {
      mode: "dex",
      priceUsd: market.priceUsd,
      marketCapUsd: market.marketCapUsd ?? market.fdvUsd,
      volume24hUsd: market.volume24hUsd,
      liquidityDisplay:
        market.liquidityUsd != null
          ? `$${market.liquidityUsd.toLocaleString("en-US")}`
          : "—",
      liquiditySub: null,
      liquidityUsdEstimate: null,
      priceSub:
        market.priceChange24hPct != null
          ? `${market.priceChange24hPct >= 0 ? "+" : ""}${market.priceChange24hPct.toFixed(2)}% 24h`
          : "DexScreener",
      volumeSub: market.volume24hUsd != null ? "24h DEX volume" : null,
      volumeIsZero: false,
      bondedSol: null,
      bondingTargetSol: 0,
      bondingProgressPct: graduation.progressPct,
      graduated: graduation.graduated,
      graduationLabel: graduation.graduated ? graduation.statusLabel : null,
      graduation,
      dexPairUrl: market.pairUrl ?? searchUrl,
      pumpFunUrl: null,
      solscanUrl: explorerUrl,
      chartEmbedId: market.pairAddress,
      chartChainSlug: "robinhood",
      sourceLabel: "DexScreener",
      chartTitle: "Market",
      chartDescription: null,
    };
  }
  if (poolAddress?.trim()) {
    return {
      mode: "bonding",
      priceUsd: null,
      marketCapUsd: null,
      volume24hUsd: null,
      liquidityDisplay: "—",
      liquiditySub: "Awaiting DexScreener index",
      liquidityUsdEstimate: null,
      priceSub: null,
      volumeSub: null,
      volumeIsZero: false,
      bondedSol: null,
      bondingTargetSol: 0,
      bondingProgressPct: graduation.progressPct,
      graduated: graduation.graduated,
      graduationLabel: graduation.statusLabel,
      graduation,
      dexPairUrl: searchUrl,
      pumpFunUrl: null,
      solscanUrl: explorerUrl,
      chartEmbedId: null,
      chartChainSlug: null,
      sourceLabel: "Robinhood Chain",
      chartTitle: "Market",
      chartDescription:
        "Token is live on Uniswap V3. Chart and volume appear once DexScreener indexes the pair.",
    };
  }
  return {
    mode: "unknown",
    priceUsd: null,
    marketCapUsd: null,
    volume24hUsd: null,
    liquidityDisplay: "—",
    liquiditySub: null,
    liquidityUsdEstimate: null,
    priceSub: null,
    volumeSub: null,
    volumeIsZero: false,
    bondedSol: null,
    bondingTargetSol: 0,
    bondingProgressPct: graduation.progressPct,
    graduated: graduation.graduated,
    graduationLabel: graduation.statusLabel,
    graduation,
    dexPairUrl: searchUrl,
    pumpFunUrl: null,
    solscanUrl: explorerUrl,
    chartEmbedId: null,
    chartChainSlug: null,
    sourceLabel: "Unavailable",
    chartTitle: "Market data unavailable",
    chartDescription: "Market data has not been indexed for this token yet.",
  };
}
