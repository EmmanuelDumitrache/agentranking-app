import { formatEther, getAddress, parseAbi, zeroAddress } from "viem";
import { createRobinhoodPublicClient } from "@/lib/robinhood-chain/client";
import { ROBINHOOD_CHAIN_CONFIG } from "@/lib/robinhood-chain/config";
import { quiverFactoryV3Abi } from "@/lib/robinhood-chain/quiver-abis";
import type { RobinhoodGraduationMetrics } from "@/lib/robinhood-chain/robinhood-graduation";

const erc20BalanceOfAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

/**
 * Quiver V3 launches are graduated at deploy (locked Uniswap v3 LP).
 * Optionally attach pool WETH as a liquidity depth signal.
 */
export async function loadRobinhoodGraduationMetrics(input: {
  tokenAddress: string;
  poolAddress?: string | null;
}): Promise<RobinhoodGraduationMetrics | null> {
  const tokenAddress = input.tokenAddress?.trim();
  if (!tokenAddress) return null;

  const client = createRobinhoodPublicClient();
  let pool = input.poolAddress?.trim() || null;

  if (!pool) {
    try {
      const info = await client.readContract({
        address: ROBINHOOD_CHAIN_CONFIG.launchFactory,
        abi: quiverFactoryV3Abi,
        functionName: "deploymentInfoForToken",
        args: [getAddress(tokenAddress)],
      });
      const [poolAddr] = info;
      if (getAddress(poolAddr) !== zeroAddress) {
        pool = getAddress(poolAddr);
      }
    } catch {
      /* fall through */
    }
  }

  if (!pool) return null;

  const wethEth = await fetchPoolWethEth(pool).catch(() => 0);

  return {
    netBuyAmountEth: wethEth,
    athNetBuyAmountEth: wethEth,
    bondingTargetEth: 0,
    source: "quiver",
  };
}

async function fetchPoolWethEth(poolAddress: string): Promise<number> {
  const client = createRobinhoodPublicClient();
  const pool = getAddress(poolAddress);
  const wethBal = await client.readContract({
    address: ROBINHOOD_CHAIN_CONFIG.weth,
    abi: erc20BalanceOfAbi,
    functionName: "balanceOf",
    args: [pool],
  });
  const eth = Number(formatEther(wethBal));
  return Number.isFinite(eth) ? eth : 0;
}
