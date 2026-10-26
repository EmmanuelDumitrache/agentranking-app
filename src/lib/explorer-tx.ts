/**
 * Default block explorer transaction URL prefixes by `chainId`.
 * Used after EVM registration/launch and for deep links; Solana uses Solscan.
 */
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
/** `prefix + txHash` = full transaction URL. */
const TX_EXPLORER_PREFIX: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  11155111: "https://sepolia.etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  84532: "https://sepolia.basescan.org/tx/",
  137: "https://polygonscan.com/tx/",
  56: "https://bscscan.com/tx/",
  42161: "https://arbiscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  100: "https://gnosisscan.io/tx/",
  534352: "https://scrollscan.com/tx/",
  43114: "https://snowscan.xyz/tx/",
  42220: "https://celoscan.io/tx/",
  59144: "https://lineascan.build/tx/",
  5000: "https://mantlescan.xyz/tx/",
  360: "https://shapescan.xyz/tx/",
  196: "https://www.oklink.com/xlayer/tx/",
  2345: "https://explorer.goat.network/tx/",
  1088: "https://andromeda-explorer.metis.io/tx/",
  1187947933: "https://skale-base-explorer.skalenodes.com/tx/",
  143: "https://monadscan.com/tx/",
  167000: "https://taikoscan.io/tx/",
  9745: "https://plasmascan.to/tx/",
  4326: "https://explorer.megaeth.com/tx/",
  2741: "https://abscan.org/tx/",
  2046399126: "https://elated-tan-skat.explorer.mainnet.skalenodes.com/tx/",
  1868: "https://soneium.blockscout.com/tx/",
  45056: "https://billions-blockscout.eu-north-2.gateway.fm/tx/",
  1776: "https://blockscout.injective.network/tx/",
  4217: "https://explore.tempo.xyz/tx/",
  42: "https://explorer.execution.mainnet.lukso.network/tx/",
  10088: "https://www.gatescan.org/gatelayer/tx/",
  5042002: "https://testnet.arcscan.app/tx/",
  [SOLANA_CHAIN_ID]: "https://solscan.io/tx/",
};
const DEFAULT_EVM_PREFIX = "https://etherscan.io/tx/";
export function getTxExplorerPrefix(chainId: number): string {
  return TX_EXPLORER_PREFIX[chainId] ?? DEFAULT_EVM_PREFIX;
}
export function getTxExplorerUrl(chainId: number, txHash: string): string {
  return `${getTxExplorerPrefix(chainId)}${txHash}`;
}