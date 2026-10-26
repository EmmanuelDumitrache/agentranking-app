import "server-only";

import { formatEther } from "viem";
import { getEthUsdPrice } from "@/lib/eth-price";
import type { DashboardRobinhoodClaimableFeesDto } from "@/lib/robinhood-chain/dashboard-claimable-fees";
import { getRobinhoodClaimableFeesForLaunch } from "@/lib/robinhood-chain/fee-claim.server";
import type { RobinhoodLaunchRecord } from "@/lib/robinhood-chain/types";

function unavailable(
  launch: RobinhoodLaunchRecord,
  reason: string,
): DashboardRobinhoodClaimableFeesDto {
  return {
    ok: true,
    canClaim: false,
    reason,
    claimableWeth: "0",
    claimableWei: "0",
    claimableTokenRaw: "0",
    hasIndexedFees: false,
    grossCollectWeth: "0",
    afterProtocolWeth: "0",
    claimableUsd: null,
    creatorWallet: launch.creatorWallet,
    positionId: launch.positionId,
    locker: "",
    tokenAddress: launch.tokenAddress,
    poolAddress: launch.poolAddress,
    protocolFeeSharePercent: 0,
    feeSplitEnabled: Boolean(launch.feeSplitterAddress),
    creatorFeeBps:
      launch.creatorFeeBps ?? (launch.feeSplitterAddress ? 7_000 : 10_000),
    arFeeBps: launch.arFeeBps ?? (launch.feeSplitterAddress ? 3_000 : 0),
    checkedAt: new Date().toISOString(),
  };
}

export async function readDashboardRobinhoodClaimableFees({
  launch,
  agentEvmAddress,
  agentEvmStatus,
}: {
  readonly launch: RobinhoodLaunchRecord;
  readonly agentEvmAddress: string | null;
  readonly agentEvmStatus: string | null;
}): Promise<DashboardRobinhoodClaimableFeesDto> {
  if (!agentEvmAddress || agentEvmStatus !== "active") {
    return unavailable(launch, "Agent EVM wallet is not configured.");
  }
  if (agentEvmAddress.toLowerCase() !== launch.creatorWallet.toLowerCase()) {
    return unavailable(
      launch,
      "Agent EVM wallet does not match launch creator wallet.",
    );
  }

  const fees = await getRobinhoodClaimableFeesForLaunch({
    tokenAddress: launch.tokenAddress,
    creatorWallet: launch.creatorWallet,
    poolAddress: launch.poolAddress,
    positionId: launch.positionId,
    feeSplitterAddress: launch.feeSplitterAddress,
  });
  const creatorFeeBps = fees.creatorFeeBps;
  const splitEnabled = fees.feeSplitEnabled;
  const creatorNetWei = splitEnabled
    ? (fees.claimableWei * BigInt(creatorFeeBps)) / 10_000n
    : fees.claimableWei;
  const creatorNetTokenRaw = splitEnabled
    ? (fees.claimableTokenRaw * BigInt(creatorFeeBps)) / 10_000n
    : fees.claimableTokenRaw;
  const creatorNetWeth = formatEther(creatorNetWei);
  const ethPrice = await getEthUsdPrice().catch(() => null);
  const claimableUsd =
    ethPrice != null && creatorNetWei > 0n
      ? (Number(creatorNetWeth) * ethPrice).toFixed(2)
      : null;

  return {
    ok: true,
    canClaim: fees.canClaim,
    ...(fees.reason ? { reason: fees.reason } : {}),
    claimableWeth: creatorNetWeth,
    claimableWei: creatorNetWei.toString(),
    claimableTokenRaw: creatorNetTokenRaw.toString(),
    hasIndexedFees: creatorNetWei > 0n || creatorNetTokenRaw > 0n,
    grossCollectWeth: formatEther(fees.grossCollectWei),
    afterProtocolWeth: fees.claimableWeth,
    claimableUsd,
    creatorWallet: fees.creatorWallet,
    positionId: fees.positionId,
    locker: fees.locker,
    tokenAddress: fees.tokenAddress,
    poolAddress: fees.poolAddress,
    protocolFeeSharePercent: fees.protocolFeeShareBps,
    feeSplitEnabled: splitEnabled,
    creatorFeeBps,
    arFeeBps: fees.arFeeBps,
    checkedAt: fees.checkedAt,
  };
}
