/**
 * Shared EVM ERC-20 transfer log fetcher.
 * Used by both the performance snapshot job and fetch-activity (Base/ETH live feed).
 */
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { base, mainnet } from "viem/chains";
export const USDC_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDT_ADDRESS_BASE = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";
export const USDC_ADDRESS_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const STABLECOIN_ADDRESSES = new Set([
  USDC_ADDRESS_BASE.toLowerCase(),
  USDT_ADDRESS_BASE.toLowerCase(),
  USDC_ADDRESS_ETH.toLowerCase(),
]);
export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);
export function getEvmClient(chainId: number) {
  const rpcUrl =
    chainId === 1
      ? (process.env.ETH_RPC_URL ?? "https://eth.llamarpc.com")
      : (process.env.BASE_RPC_URL ?? "https://mainnet.base.org");
  const chain = chainId === 1 ? mainnet : base;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}
export interface TransferLog {
  address: string;
  args: { from?: string; to?: string; value?: bigint };
  blockNumber: bigint;
  transactionHash: string;
  blockHash: string;
}
export async function fetchEvmTransferLogs(
  wallet: Address,
  chainId: number,
  blockWindow = BigInt(200_000)
): Promise<{ inbound: TransferLog[]; outbound: TransferLog[] }> {
  const client = getEvmClient(chainId);
  const blockNumber = await client.getBlockNumber();
  const fromBlock = blockNumber - blockWindow;
  const [inbound, outbound] = await Promise.all([
    client.getLogs({ event: TRANSFER_EVENT, args: { to: wallet }, fromBlock, toBlock: blockNumber }),
    client.getLogs({ event: TRANSFER_EVENT, args: { from: wallet }, fromBlock, toBlock: blockNumber }),
  ]);
  return {
    inbound: inbound as unknown as TransferLog[],
    outbound: outbound as unknown as TransferLog[],
  };
}