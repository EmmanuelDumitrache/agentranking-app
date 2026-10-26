import "server-only";

import { prisma } from "@/lib/db";
import { resolveAgentRankingFeeRecipientWallet } from "@/lib/agent-launch/fees";
import { AR_SOLANA_MINT } from "@/lib/ar-token-public";
import {
  DEFILLAMA_CATEGORY,
  DEFILLAMA_DOCS,
  DEFILLAMA_LAUNCH_URL,
  DEFILLAMA_LOGO_URL,
  DEFILLAMA_PROTOCOL_NAME,
  DEFILLAMA_PROTOCOL_SLUG,
  DEFILLAMA_ROBINHOOD_TOKENS_URL,
  DEFILLAMA_TOKENS_URL,
  DEFILLAMA_TWITTER,
  DEFILLAMA_WEBSITE,
  defillamaBranding,
} from "@/lib/defillama/branding";
import { ROBINHOOD_CHAIN_CONFIG } from "@/lib/robinhood-chain/config";
import {
  getRobinhoodArFeeTreasury,
  getRobinhoodFeeSplitterFactoryAddress,
  ROBINHOOD_AR_FEE_BPS,
  ROBINHOOD_CREATOR_FEE_BPS,
} from "@/lib/robinhood-chain/fee-splitter";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const SOLANA_FEES_START = "2026-07-01";
export const ROBINHOOD_FEES_START = "2026-07-15";

export type DefillamaFeesExport = {
  protocol: typeof DEFILLAMA_PROTOCOL_SLUG;
  name: typeof DEFILLAMA_PROTOCOL_NAME;
  website: typeof DEFILLAMA_WEBSITE;
  twitter: typeof DEFILLAMA_TWITTER;
  logo: typeof DEFILLAMA_LOGO_URL;
  category: typeof DEFILLAMA_CATEGORY;
  docs: string;
  updatedAt: string;
  chains: {
    solana: {
      label: "Solana Launchpad";
      start: string;
      treasury: string;
      wsol: string;
      blacklistMints: string[];
      methodology: string;
    };
    robinhood: {
      label: "Robinhood Chain Launchpad";
      start: string;
      chainId: number;
      treasury: string;
      weth: string;
      factory: string | null;
      creatorFeeBps: number;
      arFeeBps: number;
      splitters: string[];
      methodology: string;
    };
  };
};

export async function buildDefillamaLaunchFeesExport(): Promise<DefillamaFeesExport> {
  const splitterRows = await prisma.robinhoodChainLaunch.findMany({
    where: {
      chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
      feeSplitterAddress: { not: null },
    },
    select: { feeSplitterAddress: true },
    take: 2_000,
  });

  const seen = new Set<string>();
  const splitters: string[] = [];
  for (const row of splitterRows) {
    const address = row.feeSplitterAddress?.trim();
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    splitters.push(address);
  }

  return {
    ...defillamaBranding(),
    docs: DEFILLAMA_DOCS,
    updatedAt: new Date().toISOString(),
    chains: {
      solana: {
        label: "Solana Launchpad",
        start: SOLANA_FEES_START,
        treasury: resolveAgentRankingFeeRecipientWallet(),
        wsol: WSOL_MINT,
        blacklistMints: [AR_SOLANA_MINT],
        methodology:
          "WSOL received by the AgentRanking launch-fee treasury. That wallet is the 30% Pump creator-fee shareholder on AgentRanking-indexed launches. $AR transfers (buybacks) are excluded.",
      },
      robinhood: {
        label: "Robinhood Chain Launchpad",
        start: ROBINHOOD_FEES_START,
        chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
        treasury: getRobinhoodArFeeTreasury(),
        weth: ROBINHOOD_CHAIN_CONFIG.weth,
        factory: getRobinhoodFeeSplitterFactoryAddress(),
        creatorFeeBps: ROBINHOOD_CREATOR_FEE_BPS,
        arFeeBps: ROBINHOOD_AR_FEE_BPS,
        splitters,
        methodology:
          "FeesDistributed on AgentRanking creator fee-splitters. arAmount is protocol revenue (30%). creatorAmount is supply-side. Not Quiver/Uniswap factory TVL — those protocols already list that liquidity.",
      },
    },
  };
}

export const DEFILLAMA_LISTING_LINKS = {
  docs: DEFILLAMA_DOCS,
  launch: DEFILLAMA_LAUNCH_URL,
  tokens: DEFILLAMA_TOKENS_URL,
  robinhoodTokens: DEFILLAMA_ROBINHOOD_TOKENS_URL,
} as const;
