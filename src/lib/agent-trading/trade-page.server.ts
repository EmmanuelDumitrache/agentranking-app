import "server-only";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { loadLatestAgentLaunchForAgent } from "@/lib/agent-launch/agent-launch-for-agent";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { getDexscreenerUrl, getPumpFunUrl } from "@/lib/agent-launch/explorer-links";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadAgentWalletSolBalanceLamports } from "@/lib/dashboard/agent-overview";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
import { getAgentTradingConfig } from "@/lib/agent-trading/config";
import { getJupiterPrices, getJupiterTokenInfo } from "@/lib/agent-trading/jupiter-client";
import { loadSplTokenBalanceRaw } from "@/lib/agent-trading/spl-balance";

export type AgentTradeRow = {
  id: string;
  side: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  signature: string | null;
  status: string;
  slippageBps: number;
  priceImpactPct: string | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

export type DashboardTradePageData = {
  agent: {
    id: number;
    name: string;
    image: string;
    walletPublicKey: string | null;
    walletSolscanUrl: string | null;
    isCustodial: boolean;
    solBalanceLamports: number | null;
  };
  launchedToken: {
    mint: string;
    symbol: string | null;
    name: string | null;
    imageUrl: string | null;
    balanceRaw: string | null;
    usdPrice: number | null;
    pumpFunUrl: string;
    dexscreenerUrl: string;
  } | null;
  config: {
    defaultSlippageBps: number;
    network: string;
  };
  recentTrades: AgentTradeRow[];
};

export async function loadDashboardTradePageData(
  session: Session | null,
  agentDbId: number,
): Promise<DashboardTradePageData | null> {
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return null;

  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      name: true,
      image: true,
      owner: true,
      listingRegistrySource: true,
      chainId: true,
    },
  });
  if (!agent) return null;

  const metadataRow = await prisma.agentMetadata.findFirst({
    where: { agentId: agentDbId, key: "agentWallet" },
    select: { value: true },
  });
  const resolved = await resolveAgentWallet(agentDbId, {
    owner: agent.owner,
    listingRegistrySource: agent.listingRegistrySource ?? "",
    chainId: agent.chainId,
    metadataWallet: metadataRow?.value ?? null,
  });

  const launchConfig = getAgentLaunchConfig();
  const tradingConfig = getAgentTradingConfig();
  const launch = await loadLatestAgentLaunchForAgent(agentDbId);

  const walletPublicKey = resolved?.publicKey ?? null;
  const [solBalanceLamports, tokenBalanceRaw, recentTrades] = await Promise.all([
    loadAgentWalletSolBalanceLamports(walletPublicKey),
    launch?.mint && walletPublicKey
      ? loadSplTokenBalanceRaw(launch.mint, walletPublicKey)
      : Promise.resolve(null),
    prisma.agentTrade.findMany({
      where: { agentDbId },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  let launchedToken: DashboardTradePageData["launchedToken"] = null;
  if (launch?.mint) {
    const [tokenInfo, prices] = await Promise.all([
      getJupiterTokenInfo(launch.mint),
      getJupiterPrices([launch.mint]),
    ]);
    launchedToken = {
      mint: launch.mint,
      symbol: launch.tokenSymbol ?? tokenInfo?.symbol ?? null,
      name: launch.tokenName ?? tokenInfo?.name ?? null,
      imageUrl: launch.tokenImageUrl ?? tokenInfo?.icon ?? null,
      balanceRaw: tokenBalanceRaw?.toString() ?? null,
      usdPrice: prices[launch.mint] ?? tokenInfo?.usdPrice ?? null,
      pumpFunUrl: getPumpFunUrl(launch.mint),
      dexscreenerUrl: getDexscreenerUrl(launch.mint),
    };
  }

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      image: agent.image,
      walletPublicKey,
      walletSolscanUrl: walletPublicKey
        ? solscanAccountUrlForNetwork(walletPublicKey, launchConfig.network)
        : null,
      isCustodial: resolved?.isCustodial ?? false,
      solBalanceLamports,
    },
    launchedToken,
    config: {
      defaultSlippageBps: tradingConfig.defaultSlippageBps,
      network: launchConfig.network,
    },
    recentTrades: recentTrades.map((trade) => ({
      id: trade.id,
      side: trade.side,
      inputMint: trade.inputMint,
      outputMint: trade.outputMint,
      inputAmount: trade.inputAmount,
      outputAmount: trade.outputAmount,
      signature: trade.signature,
      status: trade.status,
      slippageBps: trade.slippageBps,
      priceImpactPct: trade.priceImpactPct,
      tokenSymbol: trade.tokenSymbol,
      tokenName: trade.tokenName,
      createdAt: trade.createdAt.toISOString(),
      confirmedAt: trade.confirmedAt?.toISOString() ?? null,
    })),
  };
}
