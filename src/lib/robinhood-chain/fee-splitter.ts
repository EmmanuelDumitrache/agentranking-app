import {
  AGENTRANKING_CREATOR_SHARE_BPS,
  AGENTRANKING_PLATFORM_SHARE_BPS,
} from "@/lib/agent-launch/fees";
import { ROBINHOOD_CHAIN_CONFIG } from "@/lib/robinhood-chain/config";
/** Same 70/30 split as Solana Pump fee sharing. */
export const ROBINHOOD_CREATOR_FEE_BPS = AGENTRANKING_CREATOR_SHARE_BPS; // 7000
export const ROBINHOOD_AR_FEE_BPS = AGENTRANKING_PLATFORM_SHARE_BPS; // 3000
/** AgentRanking Robinhood Chain fee treasury (receives 30% of creator trading fees). */
export const ROBINHOOD_AR_FEE_TREASURY_DEFAULT =
  "0x575745896498B05537b4abbF3eC9E76652D799E4" as const;
export function getRobinhoodArFeeTreasury(): `0x${string}` {
  const fromEnv = process.env.ROBINHOOD_AR_FEE_TREASURY?.trim();
  return (fromEnv || ROBINHOOD_AR_FEE_TREASURY_DEFAULT) as `0x${string}`;
}
/** Deployed CREATE2 factory — required for 70/30 launches. */
export function getRobinhoodFeeSplitterFactoryAddress(): `0x${string}` | null {
  const raw = process.env.ROBINHOOD_FEE_SPLITTER_FACTORY?.trim();
  if (!raw) return null;
  return raw as `0x${string}`;
}
export function robinhoodFeeShareLabel(): string {
  return `${ROBINHOOD_CREATOR_FEE_BPS / 100}% creator / ${ROBINHOOD_AR_FEE_BPS / 100}% AgentRanking`;
}
export const robinhoodFeeSplitterFactoryAbi = [
  {
    type: "function",
    name: "arTreasury",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "weth",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "computeAddress",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isDeployed",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deploy",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
] as const;

export const robinhoodCreatorFeeSplitterAbi = [
  { type: "function", name: "sweep", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "sweepToken", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }], stateMutability: "nonpayable" },
  {
    type: "event", name: "FeesDistributed", anonymous: false,
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "arTreasury", type: "address", indexed: true },
      { name: "creatorAmount", type: "uint256", indexed: false },
      { name: "arAmount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const erc20TransferAbi = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;
export function splitClaimableWei(claimableWei: bigint): {
  creatorWei: bigint;
  arWei: bigint;
} {
  const arWei = (claimableWei * BigInt(ROBINHOOD_AR_FEE_BPS)) / BigInt(10_000);
  return { creatorWei: claimableWei - arWei, arWei };
}
export { ROBINHOOD_CHAIN_CONFIG };
