import "server-only";
import { prisma } from "@/lib/db";
import {
  getAgentLaunchConfig,
  validateAgentLaunchConfig,
} from "@/lib/agent-launch/config";
import { getAgentLaunchWorkerPublicConfig } from "@/lib/agent-launch/config-worker.server";
import type { AgentLaunchCommandCenterSnapshot } from "@/lib/agent-launch/command-center-types";
import { assertAgentLaunchServerEnabled } from "@/lib/agent-launch/guards";
import { getMetadataProviderConfig } from "@/lib/agent-launch/metadata-provider";
import { buildLaunchMetadataDisplayInfo } from "@/lib/agent-launch/metadata-display.server";
import { getSolBalanceLamports } from "@/lib/agent-launch/transaction";
import { resolveAgentLaunchDevnetRpcUrl } from "@/lib/agent-launch/solana";
import { PublicKey } from "@solana/web3.js";
export type { AgentLaunchCommandCenterSnapshot, CommandCenterLaunchRow } from "@/lib/agent-launch/command-center-types";
async function safeBalance(address: string | null): Promise<string | null> {
  if (!address) return null;
  try {
    const lamports = await getSolBalanceLamports(new PublicKey(address));
    return lamports.toString();
  } catch {
    return null;
  }
}
export async function loadAgentLaunchCommandCenterSnapshot(): Promise<AgentLaunchCommandCenterSnapshot> {
  const guard = assertAgentLaunchServerEnabled();
  const config = getAgentLaunchConfig();
  const workerConfig = getAgentLaunchWorkerPublicConfig();
  const metadataProviderConfig = getMetadataProviderConfig();
  if (!guard.ok) {
    return {
      guard,
      featureFlags: {
        network: config.network,
        feeDistributionEnabled: workerConfig.feeDistributionEnabled,
        nodeEnv: process.env.NODE_ENV ?? "unknown",
      },
      metadataProvider: {
        active: metadataProviderConfig.provider,
        ipfsConfigured: metadataProviderConfig.ipfsConfigured,
        ipfsGateway: metadataProviderConfig.ipfsGateway,
      },
      configErrors: validateAgentLaunchConfig(config),
      treasuryWallet: config.treasury,
      workerWallet: workerConfig.feeBotPublicKey,
      workerBalanceLamports: null,
      rpcUrl: resolveAgentLaunchDevnetRpcUrl(),
      aggregateTotals: {
        totalArFeesLamports: "0",
        totalCreatorFeesLamports: "0",
        totalFeesDistributedLamports: "0",
      },
      launches: [],
    };
  }
  const [launches, eventGroups, distributionGroups, aggregates, workerBalanceLamports] =
    await Promise.all([
      prisma.agentLaunch.findMany({
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          mint: true,
          tokenName: true,
          tokenSymbol: true,
          agentId: true,
          creatorWallet: true,
          launchStatus: true,
          feeSharingStatus: true,
          creationTx: true,
          feeShareTx: true,
          metadataUri: true,
          passportUri: true,
          metadataJson: true,
          totalFeesDistributedLamports: true,
          totalCreatorFeesLamports: true,
          totalArFeesLamports: true,
          lastDistributionAt: true,
          distributionAttempts: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              status: true,
              mode: true,
              txSignature: true,
              lastError: true,
              updatedAt: true,
            },
          },
          updatedAt: true,
        },
      }),
      prisma.agentLaunchEvent.groupBy({
        by: ["launchId", "type"],
        _count: { _all: true },
        where: { type: { in: ["test_buy_confirmed", "test_sell_confirmed"] } },
      }),
      prisma.agentLaunchFeeDistribution.groupBy({
        by: ["launchId"],
        _count: { _all: true },
      }),
      prisma.agentLaunch.aggregate({
        _sum: {
          totalArFeesLamports: true,
          totalCreatorFeesLamports: true,
          totalFeesDistributedLamports: true,
        },
      }),
      safeBalance(workerConfig.feeBotPublicKey),
    ]);
  const buyCounts = new Map<string, number>();
  const sellCounts = new Map<string, number>();
  for (const row of eventGroups) {
    if (row.type === "test_buy_confirmed") {
      buyCounts.set(row.launchId, row._count._all);
    } else if (row.type === "test_sell_confirmed") {
      sellCounts.set(row.launchId, row._count._all);
    }
  }
  const distributionCounts = new Map<string, number>();
  for (const row of distributionGroups) {
    distributionCounts.set(row.launchId, row._count._all);
  }
  return {
    guard: { ok: true },
    featureFlags: {
      network: config.network,
      feeDistributionEnabled: workerConfig.feeDistributionEnabled,
      nodeEnv: process.env.NODE_ENV ?? "unknown",
    },
    metadataProvider: {
      active: metadataProviderConfig.provider,
      ipfsConfigured: metadataProviderConfig.ipfsConfigured,
      ipfsGateway: metadataProviderConfig.ipfsGateway,
    },
    configErrors: validateAgentLaunchConfig(config),
    treasuryWallet: config.treasury,
    workerWallet: workerConfig.feeBotPublicKey,
    workerBalanceLamports,
    rpcUrl: resolveAgentLaunchDevnetRpcUrl(),
    aggregateTotals: {
      totalArFeesLamports: (aggregates._sum.totalArFeesLamports ?? BigInt(0)).toString(),
      totalCreatorFeesLamports: (aggregates._sum.totalCreatorFeesLamports ?? BigInt(0)).toString(),
      totalFeesDistributedLamports: (
        aggregates._sum.totalFeesDistributedLamports ?? BigInt(0)
      ).toString(),
    },
    launches: launches.map((launch) => {
      const metadataDisplay = buildLaunchMetadataDisplayInfo(launch);
      return {
      id: launch.id,
      mint: launch.mint,
      tokenName: launch.tokenName,
      tokenSymbol: launch.tokenSymbol,
      agentId: launch.agentId,
      creatorWallet: launch.creatorWallet,
      launchStatus: launch.launchStatus,
      feeSharingStatus: launch.feeSharingStatus,
      creationTx: launch.creationTx,
      feeShareTx: launch.feeShareTx,
      metadataProvider: metadataDisplay.provider,
      metadataUri: metadataDisplay.metadataUri,
      passportUri: metadataDisplay.passportUri,
      gatewayMetadataUrl: metadataDisplay.gatewayMetadataUrl,
      gatewayPassportUrl: metadataDisplay.gatewayPassportUrl,
      totalFeesDistributedLamports: launch.totalFeesDistributedLamports.toString(),
      totalCreatorFeesLamports: launch.totalCreatorFeesLamports.toString(),
      totalArFeesLamports: launch.totalArFeesLamports.toString(),
      lastDistributionAt: launch.lastDistributionAt?.toISOString() ?? null,
      buyEventCount: buyCounts.get(launch.id) ?? 0,
      sellEventCount: sellCounts.get(launch.id) ?? 0,
      distributionCount: distributionCounts.get(launch.id) ?? 0,
      distributionAttemptStatus: launch.distributionAttempts[0]?.status ?? null,
      distributionAttemptMode: launch.distributionAttempts[0]?.mode ?? null,
      distributionAttemptSignature: launch.distributionAttempts[0]?.txSignature ?? null,
      distributionAttemptError: launch.distributionAttempts[0]?.lastError ?? null,
      distributionAttemptUpdatedAt:
        launch.distributionAttempts[0]?.updatedAt.toISOString() ?? null,
      updatedAt: launch.updatedAt.toISOString(),
    };
    }),
  };
}
