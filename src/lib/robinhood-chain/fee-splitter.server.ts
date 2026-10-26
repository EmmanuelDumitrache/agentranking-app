import "server-only";
import { getAddress } from "viem";
import { createRobinhoodPublicClient } from "@/lib/robinhood-chain/client";
import { ROBINHOOD_CHAIN_CONFIG } from "@/lib/robinhood-chain/config";
import {
  getRobinhoodArFeeTreasury,
  getRobinhoodFeeSplitterFactoryAddress,
  robinhoodFeeShareLabel,
  robinhoodFeeSplitterFactoryAbi,
  ROBINHOOD_AR_FEE_BPS,
  ROBINHOOD_CREATOR_FEE_BPS,
} from "@/lib/robinhood-chain/fee-splitter";

export type RobinhoodFeeSplitPlan = {
  enabled: boolean;
  factory: string | null;
  splitter: string | null;
  splitterDeployed: boolean;
  creatorWallet: string;
  arTreasury: string;
  creatorFeeBps: number;
  arFeeBps: number;
  label: string;
};

/** Resolve and verify the deterministic splitter configured for a creator. */
export async function resolveRobinhoodFeeSplitPlan(
  creatorWallet: string,
): Promise<RobinhoodFeeSplitPlan> {
  const creator = getAddress(creatorWallet);
  const arTreasury = getAddress(getRobinhoodArFeeTreasury());
  const factory = getRobinhoodFeeSplitterFactoryAddress();
  const base = {
    creatorWallet: creator,
    arTreasury,
    creatorFeeBps: ROBINHOOD_CREATOR_FEE_BPS,
    arFeeBps: ROBINHOOD_AR_FEE_BPS,
    label: robinhoodFeeShareLabel(),
  };
  if (!factory) {
    return {
      ...base,
      enabled: false,
      factory: null,
      splitter: null,
      splitterDeployed: false,
    };
  }

  const client = createRobinhoodPublicClient();
  const factoryAddress = getAddress(factory);
  const [splitter, deployed, configuredTreasury, configuredWeth] = await Promise.all([
    client.readContract({
      address: factoryAddress,
      abi: robinhoodFeeSplitterFactoryAbi,
      functionName: "computeAddress",
      args: [creator],
    }),
    client.readContract({
      address: factoryAddress,
      abi: robinhoodFeeSplitterFactoryAbi,
      functionName: "isDeployed",
      args: [creator],
    }),
    client.readContract({
      address: factoryAddress,
      abi: robinhoodFeeSplitterFactoryAbi,
      functionName: "arTreasury",
    }),
    client.readContract({
      address: factoryAddress,
      abi: robinhoodFeeSplitterFactoryAbi,
      functionName: "weth",
    }),
  ]);

  if (getAddress(configuredTreasury) !== arTreasury) {
    throw new Error("Configured Robinhood fee splitter factory uses an unexpected treasury.");
  }
  if (getAddress(configuredWeth) !== getAddress(ROBINHOOD_CHAIN_CONFIG.weth)) {
    throw new Error("Configured Robinhood fee splitter factory uses an unexpected WETH token.");
  }

  return {
    ...base,
    enabled: true,
    factory: factoryAddress,
    splitter: getAddress(splitter),
    splitterDeployed: Boolean(deployed),
  };
}
