import "server-only";
import {
  decodeEventLog,
  getAddress,
  isAddress,
  zeroAddress,
  type Hex,
} from "viem";
import {
  ROBINHOOD_CHAIN_CONFIG,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_FRONTEND_SOURCE_LABEL,
  ROBINHOOD_LAUNCH_SOURCE,
} from "@/lib/robinhood-chain/config";
import { createRobinhoodPublicClient } from "@/lib/robinhood-chain/client";
import { quiverFactoryV3Abi, quiverTokenAbi } from "@/lib/robinhood-chain/quiver-abis";
import { poolAddressFromQuiverPoolId } from "@/lib/robinhood-chain/quiver-launch";
/** Normalized launch event — Quiver TokenCreated mapped to our DB shape. */
export type TokenLaunchedEvent = {
  token: string;
  deployer: string;
  dexFactory: string;
  pairToken: string;
  pool: string;
  dexId: bigint;
  launchConfigId: bigint;
  positionId: bigint;
  restrictionsEndBlock: bigint;
  initialBuyAmount: bigint;
};
export type OnChainTokenReads = {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  liquidityPool: string | null;
  pairToken: string | null;
  poolFee: number | null;
  maxWalletLimit: string | null;
  maxTxLimit: string | null;
  restrictionEndBlock: string | null;
  launchFactory: string | null;
  creatorRecipient: string | null;
  image: string | null;
};
async function safeRead<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
export function parseTokenLaunchedFromReceipt(
  logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[],
): TokenLaunchedEvent | null {
  const factory = ROBINHOOD_CHAIN_CONFIG.launchFactory.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== factory) continue;
    try {
      const decoded = decodeEventLog({
        abi: quiverFactoryV3Abi,
        eventName: "TokenCreated",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const poolFromId = poolAddressFromQuiverPoolId(decoded.args.poolId);
      const pool =
        poolFromId && getAddress(poolFromId) !== zeroAddress
          ? getAddress(poolFromId)
          : getAddress(decoded.args.tokenAddress);
      return {
        token: getAddress(decoded.args.tokenAddress),
        deployer: getAddress(decoded.args.tokenAdmin),
        dexFactory: ROBINHOOD_CHAIN_CONFIG.uniswapV3Factory,
        pairToken: getAddress(decoded.args.pairedToken),
        pool,
        dexId: BigInt(0),
        launchConfigId: BigInt(0),
        positionId: BigInt(0),
        restrictionsEndBlock: BigInt(0),
        initialBuyAmount: BigInt(0),
      };
    } catch {
      continue;
    }
  }
  return null;
}
export async function verifyRobinhoodLaunchSource(tokenAddress: string): Promise<boolean> {
  if (!isAddress(tokenAddress)) return false;
  const client = createRobinhoodPublicClient();
  const token = getAddress(tokenAddress);
  const factory = ROBINHOOD_CHAIN_CONFIG.launchFactory;
  const info = await safeRead(() =>
    client.readContract({
      address: factory,
      abi: quiverFactoryV3Abi,
      functionName: "deploymentInfoForToken",
      args: [token],
    }),
  );
  if (!info) return false;
  const [pool] = info;
  return getAddress(pool) !== zeroAddress;
}
export async function readRobinhoodTokenOnChain(tokenAddress: string): Promise<OnChainTokenReads> {
  const token = getAddress(tokenAddress);
  const client = createRobinhoodPublicClient();
  const factory = ROBINHOOD_CHAIN_CONFIG.launchFactory;
  const [name, symbol, decimals, totalSupply, image, deployment] = await Promise.all([
    safeRead(() => client.readContract({ address: token, abi: quiverTokenAbi, functionName: "name" })),
    safeRead(() => client.readContract({ address: token, abi: quiverTokenAbi, functionName: "symbol" })),
    safeRead(() => client.readContract({ address: token, abi: quiverTokenAbi, functionName: "decimals" })),
    safeRead(() => client.readContract({ address: token, abi: quiverTokenAbi, functionName: "totalSupply" })),
    safeRead(() => client.readContract({ address: token, abi: quiverTokenAbi, functionName: "image" })),
    safeRead(() =>
      client.readContract({
        address: factory,
        abi: quiverFactoryV3Abi,
        functionName: "deploymentInfoForToken",
        args: [token],
      }),
    ),
  ]);
  const pool = deployment?.[0] && getAddress(deployment[0]) !== zeroAddress
    ? getAddress(deployment[0])
    : null;
  const poolFee = await safeRead(() =>
    client.readContract({
      address: factory,
      abi: quiverFactoryV3Abi,
      functionName: "POOL_FEE",
    }),
  );
  return {
    name,
    symbol,
    decimals: decimals != null ? Number(decimals) : null,
    totalSupply: totalSupply != null ? totalSupply.toString() : null,
    liquidityPool: pool,
    pairToken: ROBINHOOD_CHAIN_CONFIG.weth,
    poolFee: poolFee != null ? Number(poolFee) : null,
    maxWalletLimit: null,
    maxTxLimit: null,
    restrictionEndBlock: null,
    launchFactory: factory,
    creatorRecipient: deployment?.[2] ? getAddress(deployment[2]) : null,
    image: image?.trim() || null,
  };
}
export function robinhoodLaunchDefaults() {
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    source: ROBINHOOD_LAUNCH_SOURCE,
    frontendSourceLabel: ROBINHOOD_FRONTEND_SOURCE_LABEL,
  };
}
