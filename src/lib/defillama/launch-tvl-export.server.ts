import "server-only";

import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { defillamaBranding } from "@/lib/defillama/branding";
import { ROBINHOOD_CHAIN_CONFIG } from "@/lib/robinhood-chain/config";

/** Pump.fun bonding program — bonding-curve SOL lives on these PDAs. */
export const PUMP_BONDING_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

export type DefillamaSolanaLaunchExport = {
  mint: string;
  bondingCurve: string;
  symbol: string | null;
  name: string | null;
};

export type DefillamaRobinhoodLaunchExport = {
  token: string;
  pool: string;
  symbol: string | null;
  name: string | null;
};

export type DefillamaLaunchTvlExport = {
  protocol: "agentranking";
  name: string;
  website: string;
  twitter: string;
  logo: string;
  category: string;
  updatedAt: string;
  chains: {
    solana: {
      label: "Solana Launchpad";
      asset: "SOL";
      methodology:
        "SOL locked in Pump.fun bonding-curve accounts for AgentRanking-indexed mainnet launches.";
      launches: DefillamaSolanaLaunchExport[];
      bondingCurves: string[];
    };
    robinhoodchain: {
      label: "Robinhood Chain Launchpad";
      asset: "WETH";
      factory: string;
      lpLocker: string;
      weth: string;
      uniswapV3Factory: string;
      methodology:
        "WETH balances in Uniswap V3 pools for AgentRanking launches on Robinhood Chain.";
      launches: DefillamaRobinhoodLaunchExport[];
      pools: string[];
    };
  };
};

function safeBondingCurve(mint: string): string | null {
  try {
    return bondingCurvePda(new PublicKey(mint)).toBase58();
  } catch {
    return null;
  }
}

export async function buildDefillamaLaunchTvlExport(): Promise<DefillamaLaunchTvlExport> {
  const [solanaRows, robinhoodRows] = await Promise.all([
    prisma.agentLaunch.findMany({
      where: {
        network: "mainnet-beta",
        launchStatus: "indexed",
        mint: { not: null },
      },
      select: {
        mint: true,
        tokenSymbol: true,
        tokenName: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5_000,
    }),
    prisma.robinhoodChainLaunch.findMany({
      where: {
        chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
        OR: [{ launchedViaAgentRanking: true }, { sourceVerified: true }],
        poolAddress: { not: "" },
      },
      select: {
        tokenAddress: true,
        poolAddress: true,
        tokenSymbol: true,
        tokenName: true,
      },
      orderBy: { blockTimestamp: "desc" },
      take: 5_000,
    }),
  ]);

  const solanaLaunches: DefillamaSolanaLaunchExport[] = [];
  const bondingCurves: string[] = [];
  const seenCurves = new Set<string>();

  for (const row of solanaRows) {
    const mint = row.mint?.trim();
    if (!mint) continue;
    const bondingCurve = safeBondingCurve(mint);
    if (!bondingCurve || seenCurves.has(bondingCurve)) continue;
    seenCurves.add(bondingCurve);
    bondingCurves.push(bondingCurve);
    solanaLaunches.push({
      mint,
      bondingCurve,
      symbol: row.tokenSymbol,
      name: row.tokenName,
    });
  }

  const robinhoodLaunches: DefillamaRobinhoodLaunchExport[] = [];
  const pools: string[] = [];
  const seenPools = new Set<string>();

  for (const row of robinhoodRows) {
    const token = row.tokenAddress?.trim();
    const pool = row.poolAddress?.trim();
    if (!token || !pool) continue;
    const poolKey = pool.toLowerCase();
    if (seenPools.has(poolKey)) continue;
    seenPools.add(poolKey);
    pools.push(pool);
    robinhoodLaunches.push({
      token,
      pool,
      symbol: row.tokenSymbol,
      name: row.tokenName,
    });
  }

  const branding = defillamaBranding();
  return {
    protocol: branding.protocol,
    name: branding.name,
    website: branding.website,
    twitter: branding.twitter,
    logo: branding.logo,
    category: branding.category,
    updatedAt: new Date().toISOString(),
    chains: {
      solana: {
        label: "Solana Launchpad",
        asset: "SOL",
        methodology:
          "SOL locked in Pump.fun bonding-curve accounts for AgentRanking-indexed mainnet launches.",
        launches: solanaLaunches,
        bondingCurves,
      },
      robinhoodchain: {
        label: "Robinhood Chain Launchpad",
        asset: "WETH",
        factory: ROBINHOOD_CHAIN_CONFIG.launchFactory,
        lpLocker: ROBINHOOD_CHAIN_CONFIG.launchLocker,
        weth: ROBINHOOD_CHAIN_CONFIG.weth,
        uniswapV3Factory: ROBINHOOD_CHAIN_CONFIG.uniswapV3Factory,
        methodology:
          "WETH balances in Uniswap V3 pools for AgentRanking launches on Robinhood Chain.",
        launches: robinhoodLaunches,
        pools,
      },
    },
  };
}
