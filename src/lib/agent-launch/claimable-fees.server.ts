import "server-only";

import { PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import type { AgentLaunch } from "@/generated/prisma/client";
import type { AgentLaunchClaimableFeesDto } from "@/lib/agent-launch/claimable-fees";
import { loadAgentLaunchOrThrow } from "@/lib/agent-launch/launch-access";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";

const LAMPORTS_PER_SOL = 1_000_000_000;

function lamportsToSol(lamports: bigint | string): number {
  return Number(typeof lamports === "bigint" ? lamports : BigInt(lamports || "0")) /
    LAMPORTS_PER_SOL;
}

function creatorShareSol(poolSol: number, shareBps: number): number {
  if (poolSol <= 0 || shareBps <= 0) return 0;
  return (poolSol * shareBps) / 10_000;
}

export async function readAgentLaunchClaimableFeesForLaunch(
  launch: AgentLaunch,
): Promise<AgentLaunchClaimableFeesDto> {
  const distributedCreatorSol = lamportsToSol(launch.totalCreatorFeesLamports);
  const totalDistributedSol = lamportsToSol(launch.totalFeesDistributedLamports);
  const base = {
    ok: true as const,
    launchId: launch.id,
    network: launch.network,
    feeSharingStatus: launch.feeSharingStatus,
    agentShareBps: launch.creatorShareBps,
    arShareBps: launch.arShareBps,
    agentWallet: launch.creatorWallet,
    feeRecipientWallet: launch.arTreasuryWallet,
    lastDistributionTx: launch.feeShareTx ?? null,
    distributedCreatorSol,
    totalDistributedSol,
  };

  if (!launch.mint) {
    return {
      ...base,
      mint: null,
      canDistribute: false,
      reason: "No mint — token not yet created",
      claimableSol: null,
      accruedCreatorSol: null,
      earnedCreatorSol: distributedCreatorSol,
    };
  }

  try {
    const onlineSdk = new OnlinePumpSdk(getAgentLaunchConnection());
    const minimum = await onlineSdk.getMinimumDistributableFee(
      new PublicKey(launch.mint),
    );
    const distributable = BigInt(minimum.distributableFees.toString());
    const claimableSol = lamportsToSol(distributable);
    const accruedCreatorSol = creatorShareSol(claimableSol, launch.creatorShareBps);
    return {
      ...base,
      mint: launch.mint,
      canDistribute: minimum.canDistribute,
      ...(!minimum.canDistribute
        ? {
            reason:
              distributable === 0n
                ? "No claimable fees yet — trades must generate creator fees first."
                : "Claimable amount below Pump.fun minimum threshold.",
          }
        : {}),
      claimableSol,
      accruedCreatorSol,
      earnedCreatorSol: distributedCreatorSol + accruedCreatorSol,
    };
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    return {
      ...base,
      mint: launch.mint,
      canDistribute: false,
      reason:
        message.includes("429") || message.toLowerCase().includes("rate limit")
          ? "Solana RPC rate limited — try refreshing fees in a moment."
          : `Could not read claimable fees: ${message}`,
      claimableSol: null,
      accruedCreatorSol: null,
      earnedCreatorSol: distributedCreatorSol,
    };
  }
}

export async function readAgentLaunchClaimableFees(
  launchId: string,
): Promise<AgentLaunchClaimableFeesDto> {
  return readAgentLaunchClaimableFeesForLaunch(
    await loadAgentLaunchOrThrow(launchId),
  );
}
