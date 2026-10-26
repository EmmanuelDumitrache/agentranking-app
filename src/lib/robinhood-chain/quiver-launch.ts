import { toHex, type Address, type Hex } from "viem";
import { ROBINHOOD_CHAIN_ID } from "@/lib/robinhood-chain/config";
/** Match quiver-contracts / quiverfun web launch curve. */
export const QUIVER_STARTING_TICK = -204_400;
export const QUIVER_TICK_UPPER = 887_200;
export const QUIVER_LP_FEE = 10_000; // 1%
export const QUIVER_LAUNCH_CONTEXT = '{"interface":"agentranking"}';
export type QuiverLaunchEncodeInput = {
  name: string;
  symbol: string;
  creator: Address;
  creatorRecipient?: Address;
  image: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
  farcaster?: string;
};
function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
/** Args for Quiver factoryV3.deployToken (payable value = optional initial buy). */
export function buildQuiverV3DeployArgs(input: QuiverLaunchEncodeInput) {
  const metadata = JSON.stringify({
    description: input.description ?? "",
    twitter: input.twitter ?? "",
    telegram: input.telegram ?? "",
    website: input.website ?? "",
    discord: input.discord ?? "",
    farcaster: input.farcaster ?? "",
  });
  return [
    {
      tokenAdmin: input.creator,
      name: input.name,
      symbol: input.symbol,
      salt: randomSalt(),
      image: input.image,
      metadata,
      context: QUIVER_LAUNCH_CONTEXT,
      originatingChainId: BigInt(ROBINHOOD_CHAIN_ID),
    },
    QUIVER_STARTING_TICK,
    [{ tickLower: QUIVER_STARTING_TICK, tickUpper: QUIVER_TICK_UPPER, bps: 10_000 }],
    input.creatorRecipient ?? input.creator,
  ] as const;
}
/** v3 TokenCreated.poolId packs the Uniswap v3 pool address in the low 20 bytes. */
export function poolAddressFromQuiverPoolId(poolId: Hex | string): string | null {
  const hex = poolId.toLowerCase().replace(/^0x/, "");
  if (hex.length < 40) return null;
  return `0x${hex.slice(-40)}`;
}
