import "server-only";

import { prisma } from "@/lib/db";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";
import { lavaraveApi } from "@/lib/agent-trading/lavarave/client";
import { getLavaraveConfig } from "@/lib/agent-trading/lavarave/config";
import { parseLavaraveOffers, type LavaraveOffer } from "@/lib/agent-trading/lavarave/offers";
import {
  filterPositionsForWallet,
  parseLavaravePositions,
  type LavaravePosition,
} from "@/lib/agent-trading/lavarave/positions";

type AgentWalletResult =
  | { ok: true; walletPk: string; isCustodial: boolean }
  | { ok: false; message: string };

export async function resolveAgentWalletForLavarage(agentDbId: number): Promise<AgentWalletResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { owner: true, listingRegistrySource: true, chainId: true },
  });
  if (!agent) return { ok: false, message: "Agent not found" };

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

  if (!resolved?.publicKey) {
    return { ok: false, message: "Agent wallet not configured" };
  }
  if (!resolved.isCustodial) {
    return { ok: false, message: "Lavarage trading requires a custodial agent wallet" };
  }

  return { ok: true, walletPk: resolved.publicKey, isCustodial: true };
}

export async function loadLavaraveOffers(): Promise<LavaraveOffer[]> {
  const config = getLavaraveConfig();
  if (!config.enabled) return [];
  const raw = await lavaraveApi.offersV2();
  return parseLavaraveOffers(raw);
}

export async function loadLavaraveOpenPositions(walletPk: string): Promise<LavaravePosition[]> {
  const config = getLavaraveConfig();
  if (!config.enabled) return [];
  const raw = await lavaraveApi.openPositionsV2();
  return filterPositionsForWallet(parseLavaravePositions(raw, walletPk), walletPk);
}

export async function openLavaraveLongPosition(input: {
  agentDbId: number;
  symbol: string;
  amountSol: number;
  leverageX: number;
  slippagePct: number;
}): Promise<{ ok: true; txid: string } | { ok: false; message: string }> {
  const wallet = await resolveAgentWalletForLavarage(input.agentDbId);
  if (!wallet.ok) return { ok: false, message: wallet.message };

  const { statusCode, data } = await lavaraveApi.openPosition({
    symbol: input.symbol,
    walletPk: wallet.walletPk,
    amountSol: input.amountSol,
    leverageX: input.leverageX,
    slippagePct: input.slippagePct,
  });

  if (statusCode < 200 || statusCode >= 300) {
    const reason =
      typeof data === "object" && data != null ? JSON.stringify(data) : String(data ?? statusCode);
    return { ok: false, message: `Open failed (${statusCode}): ${reason}` };
  }

  const record = data as Record<string, unknown> | null;
  const txid =
    (typeof record?.txid === "string" && record.txid)
    || (typeof record?.signature === "string" && record.signature)
    || (typeof record?.tx === "string" && record.tx)
    || (typeof record?.result === "string" && record.result)
    || "submitted";

  return { ok: true, txid };
}

export async function sellLavaravePosition(input: {
  agentDbId: number;
  positionId: string;
}): Promise<{ ok: true; txid: string } | { ok: false; message: string }> {
  const wallet = await resolveAgentWalletForLavarage(input.agentDbId);
  if (!wallet.ok) return { ok: false, message: wallet.message };

  const { statusCode, data } = await lavaraveApi.sellPosition({
    positionId: input.positionId,
    walletPk: wallet.walletPk,
  });

  if (statusCode < 200 || statusCode >= 300) {
    const reason =
      typeof data === "object" && data != null ? JSON.stringify(data) : String(data ?? statusCode);
    return { ok: false, message: `Close failed (${statusCode}): ${reason}` };
  }

  const record = data as Record<string, unknown> | null;
  const txid =
    (typeof record?.txid === "string" && record.txid)
    || (typeof record?.signature === "string" && record.signature)
    || "submitted";

  return { ok: true, txid };
}
