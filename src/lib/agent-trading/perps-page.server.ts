import "server-only";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { getAgentTradingConfig } from "@/lib/agent-trading/config";
import { getLavaraveConfig } from "@/lib/agent-trading/lavarave/config";
import {
  loadLavaraveOffers,
  loadLavaraveOpenPositions,
} from "@/lib/agent-trading/lavarave/service";
import type { LavaraveOffer } from "@/lib/agent-trading/lavarave/offers";
import type { LavaravePosition } from "@/lib/agent-trading/lavarave/positions";
import { loadAgentWalletSolBalanceLamports } from "@/lib/dashboard/agent-overview";

export type DashboardTradePerpsPageData = {
  agent: {
    id: number;
    name: string;
    image: string;
    walletPublicKey: string | null;
    walletSolscanUrl: string | null;
    isCustodial: boolean;
    solBalanceLamports: number | null;
  };
  lavarave: {
    enabled: boolean;
    offers: LavaraveOffer[];
    positions: LavaravePosition[];
  };
  config: {
    network: string;
    defaultSlippageBps: number;
  };
};

export async function loadDashboardTradePerpsPageData(
  session: Session | null,
  agentDbId: number,
): Promise<DashboardTradePerpsPageData | null> {
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
  const lavaraveConfig = getLavaraveConfig();
  const walletPublicKey = resolved?.publicKey ?? null;

  const [solBalanceLamports, offers, positions] = await Promise.all([
    loadAgentWalletSolBalanceLamports(walletPublicKey),
    lavaraveConfig.enabled ? loadLavaraveOffers().catch(() => []) : Promise.resolve([]),
    lavaraveConfig.enabled && walletPublicKey
      ? loadLavaraveOpenPositions(walletPublicKey).catch(() => [])
      : Promise.resolve([]),
  ]);

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
    lavarave: {
      enabled: lavaraveConfig.enabled,
      offers,
      positions,
    },
    config: {
      network: launchConfig.network,
      defaultSlippageBps: tradingConfig.defaultSlippageBps,
    },
  };
}
