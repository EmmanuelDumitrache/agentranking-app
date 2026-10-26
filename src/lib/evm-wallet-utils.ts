/**
 * EVM wallet display utilities (non-JSX) shared across AgentRanking dashboard components.
 */
import { createRobinhoodPublicClient } from "@/lib/robinhood-chain/client";
import {
  robinhoodExplorerAddressUrl,
  robinhoodExplorerTxUrl,
  ROBINHOOD_CHAIN_ID,
} from "@/lib/robinhood-chain/config";
import { createPublicClient, formatEther, http, type Address } from "viem";
import { mainnet } from "viem/chains";
const ETHEREUM_MAINNET_RPC =
  process.env.ETHEREUM_MAINNET_RPC_URL?.trim() || "https://ethereum.publicnode.com";
/** Format an EVM address for compact display. */
export function shortenEvmAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}
export type EvmEthBalance = {
  wei: string;
  ether: string;
};
async function fetchChainEthBalance(
  getBalance: () => Promise<bigint>,
): Promise<EvmEthBalance | null> {
  try {
    const balance = await getBalance();
    return {
      wei: balance.toString(),
      ether: formatEther(balance),
    };
  } catch {
    return null;
  }
}
/** Fetch ETH balance on Ethereum mainnet (where users typically fund first). */
export async function fetchEthereumMainnetEthBalance(address: string): Promise<EvmEthBalance | null> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(ETHEREUM_MAINNET_RPC),
  });
  return fetchChainEthBalance(() =>
    client.getBalance({ address: address as Address }),
  );
}
/** Fetch ETH balance on Robinhood Chain — required for Robinhood launches. */
export async function fetchRobinhoodChainEthBalance(address: string): Promise<EvmEthBalance | null> {
  const client = createRobinhoodPublicClient();
  return fetchChainEthBalance(() =>
    client.getBalance({ address: address as Address }),
  );
}
/** Compact ETH display for pills and summary rows (e.g. 0.0055 not 0.00548118). */
export function formatEthCompact(ether: string | number | null | undefined): string {
  if (ether == null || ether === "—") return "—";
  const num = typeof ether === "string" ? Number.parseFloat(ether) : ether;
  if (!Number.isFinite(num)) return "—";
  if (num === 0) return "0";
  if (num >= 1) return num.toFixed(3).replace(/\.?0+$/, "");
  if (num >= 0.01) return num.toFixed(4).replace(/\.?0+$/, "");
  if (num >= 0.0001) return num.toFixed(4).replace(/\.?0+$/, "");
  return num.toFixed(6).replace(/\.?0+$/, "");
}
/** Primary address link — Ethereum mainnet (Etherscan). */
export function evmExplorerUrl(address: string): string {
  return ethereumMainnetExplorerUrl(address);
}
export function ethereumMainnetExplorerUrl(address: string): string {
  return `https://etherscan.io/address/${address}`;
}
export function ethereumMainnetExplorerTxUrl(txHash: string): string {
  return `https://etherscan.io/tx/${txHash}`;
}
/** Robinhood Chain explorer (launch gas / on-chain launches). */
export function robinhoodChainExplorerUrl(address: string): string {
  return robinhoodExplorerAddressUrl(address);
}
export function robinhoodChainExplorerTxUrl(txHash: string): string {
  return robinhoodExplorerTxUrl(txHash);
}
export const EVM_CHAIN_ID = ROBINHOOD_CHAIN_ID;
export const EVM_NETWORK_NAME = "Robinhood Chain";
export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const ETHEREUM_MAINNET_NAME = "Ethereum";
