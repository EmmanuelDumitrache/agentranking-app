import "server-only";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";
import { loadClientModelOptions } from "@/features/agent-chat/server/dashboard-bootstrap";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import type { ClientModelOption } from "@/features/agent-chat/shared/contracts";
import type { CopyLeaderboardTrader } from "@/lib/agent-trading/copy-trade/types";
import { loadPerpsoSpotLeaderboard } from "@/lib/agent-trading/perpso/client";
import { PERPSO_LEADERBOARD_PAGE_SIZE } from "@/lib/agent-trading/perpso/urls";
import type { AgentTradeRow } from "@/lib/agent-trading/trade-page.server";

export type CopyTradeConfigRow = {
  id: string;
  label: string | null;
  targetWallet: string;
  venue: string;
  status: string;
  buyMode: string;
  buyPercent: number;
  buySolAmount: number | null;
  sellPercent: number;
  maxBuySol: number | null;
  sizingMode: string;
  portfolioAllocationPct: number;
  maxPositionUsd: number | null;
  leverage: number;
  loopCadenceSec: number;
  llmModelKey: string | null;
  llmBudgetUsd: number | null;
  mirrorCount: number;
  lastMirroredAt: string | null;
  createdAt: string;
};

export type CopyTradeLlmModelOption = Pick<
  ClientModelOption,
  "modelKey" | "label" | "isFree" | "isDefault" | "availability" | "providerLabel"
>;

export type DashboardCopyTradePageData = {
  agent: {
    id: number;
    name: string;
    image: string;
    walletPublicKey: string | null;
    isCustodial: boolean;
  };
  configs: CopyTradeConfigRow[];
  trades: AgentTradeRow[];
  leaderboard: CopyLeaderboardTrader[];
  llmModels: CopyTradeLlmModelOption[];
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

function mapConfig(row: {
  id: string;
  label: string | null;
  targetWallet: string;
  venue: string;
  status: string;
  buyMode: string;
  buyPercent: number;
  buySolAmount: number | null;
  sellPercent: number;
  maxBuySol: number | null;
  sizingMode: string;
  portfolioAllocationPct: number;
  maxPositionUsd: number | null;
  leverage: number;
  loopCadenceSec: number;
  llmModelKey: string | null;
  llmBudgetUsd: number | null;
  mirrorCount: number;
  lastMirroredAt: Date | null;
  createdAt: Date;
}): CopyTradeConfigRow {
  return {
    id: row.id,
    label: row.label,
    targetWallet: row.targetWallet,
    venue: row.venue,
    status: row.status,
    buyMode: row.buyMode,
    buyPercent: row.buyPercent,
    buySolAmount: row.buySolAmount,
    sellPercent: row.sellPercent,
    maxBuySol: row.maxBuySol,
    sizingMode: row.sizingMode,
    portfolioAllocationPct: row.portfolioAllocationPct,
    maxPositionUsd: row.maxPositionUsd,
    leverage: row.leverage,
    loopCadenceSec: row.loopCadenceSec,
    llmModelKey: row.llmModelKey,
    llmBudgetUsd: row.llmBudgetUsd,
    mirrorCount: row.mirrorCount,
    lastMirroredAt: row.lastMirroredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadDashboardCopyTradePageData(
  session: Session | null,
  agentDbId: number,
): Promise<DashboardCopyTradePageData | null> {
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return null;
  const chatAccess = await getAgentChatAccess(session, agentDbId, { allowDisabled: true });

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

  const walletPublicKey = resolved?.publicKey ?? null;

  const [configs, trades, leaderboard, modelOptions] = await Promise.all([
    prisma.agentCopyTradeConfig.findMany({
      where: { agentDbId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentTrade.findMany({
      where: { agentDbId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    loadPerpsoSpotLeaderboard(PERPSO_LEADERBOARD_PAGE_SIZE).catch(() => [] as CopyLeaderboardTrader[]),
    loadClientModelOptions(chatAccess.appAccountId).catch(() => ({ models: [] as ClientModelOption[] })),
  ]);

  const llmModels = modelOptions.models
    .filter((model) => model.availability === "available")
    .map((model) => ({
      modelKey: model.modelKey,
      label: model.label,
      isFree: model.isFree,
      isDefault: model.isDefault,
      availability: model.availability,
      providerLabel: model.providerLabel,
    }))
    .sort((a, b) => {
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      image: agent.image,
      walletPublicKey,
      isCustodial: resolved?.isCustodial ?? false,
    },
    configs: configs.map(mapConfig),
    trades: trades.map(mapTradeRow),
    leaderboard,
    llmModels,
  };
}
