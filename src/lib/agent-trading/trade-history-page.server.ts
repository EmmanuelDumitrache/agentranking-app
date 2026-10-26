import "server-only";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadAgentWalletSolBalanceLamports } from "@/lib/dashboard/agent-overview";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { USDC_MINT } from "@/lib/agent-trading/constants";
import { getAgentTradingConfig } from "@/lib/agent-trading/config";
import type { AgentTradeRow } from "@/lib/agent-trading/trade-page.server";
import { loadSplTokenBalanceRaw } from "@/lib/agent-trading/spl-balance";

export type DashboardTradeHistoryPageData = {
  agent: {
    id: number;
    name: string;
    image: string;
    walletPublicKey: string | null;
    walletSolscanUrl: string | null;
    isCustodial: boolean;
    solBalanceLamports: number | null;
    usdcBalanceRaw: string | null;
    usdcDecimals: number;
  };
  config: {
    network: string;
    defaultSlippageBps: number;
  };
  trades: AgentTradeRow[];
  stats: {
    total: number;
    confirmed: number;
    failed: number;
    pending: number;
  };
};

function mapTradeRow(trade: {
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
  createdAt: Date;
  confirmedAt: Date | null;
}): AgentTradeRow {
  return {
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
  };
}

export async function loadDashboardTradeHistoryPageData(
  session: Session | null,
  agentDbId: number,
): Promise<DashboardTradeHistoryPageData | null> {
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
  const walletPublicKey = resolved?.publicKey ?? null;

  const [solBalanceLamports, usdcBalance, trades] = await Promise.all([
    loadAgentWalletSolBalanceLamports(walletPublicKey),
    walletPublicKey
      ? loadSplTokenBalanceRaw(USDC_MINT, walletPublicKey)
      : Promise.resolve(null),
    prisma.agentTrade.findMany({
      where: { agentDbId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const rows = trades.map(mapTradeRow);

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
      usdcBalanceRaw: usdcBalance?.toString() ?? null,
      usdcDecimals: 6,
    },
    config: {
      network: launchConfig.network,
      defaultSlippageBps: tradingConfig.defaultSlippageBps,
    },
    trades: rows,
    stats: {
      total: rows.length,
      confirmed: rows.filter((t) => t.status === "confirmed").length,
      failed: rows.filter((t) => t.status === "failed").length,
      pending: rows.filter((t) => t.status === "pending").length,
    },
  };
}
