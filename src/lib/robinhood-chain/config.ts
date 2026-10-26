import { defineChain } from "viem";
/** Robinhood Chain — sole supported chain for AgentRanking Robinhood launches. */
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_CONFIG = {
  chainId: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeSymbol: "ETH",
  rpcUrl:
    process.env.ROBINHOOD_CHAIN_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com",
  blockExplorerUrl: "https://robinhoodchain.blockscout.com",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const,
  /** Quiver factoryV3 — preferred launch path (Uniswap v3 + locked LP). */
  launchFactory: "0xaA8Af274bba2b9dE53119CB117C8AC6A39e6F5Aa" as const,
  /** Quiver LP locker for v3 creator rewards (`collectRewards`). */
  launchLocker: "0x38daBB90C96eea7B90613ABbf019ABCe0808CF12" as const,
  /** Quiver fee locker (legacy v4 path / availableFees reads). */
  feeLocker: "0xd1B13382fDa3E165658F1d3502d6616A31B62491" as const,
  /** Uniswap v3 factory on Robinhood Chain. */
  uniswapV3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as const,
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11" as const,
  /** factoryV3 deploy block — indexer / import floor. */
  launchFactoryStartBlock: 9_398_052,
} as const;
/** Internal provider id — never shown in user-facing UI. */
export const ROBINHOOD_LAUNCH_SOURCE = "quiver" as const;
export const ROBINHOOD_FRONTEND_SOURCE_LABEL = "AgentRanking Launch" as const;
export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: ROBINHOOD_CHAIN_CONFIG.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ROBINHOOD_CHAIN_CONFIG.rpcUrl] },
    public: { http: [ROBINHOOD_CHAIN_CONFIG.rpcUrl] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Explorer",
      url: ROBINHOOD_CHAIN_CONFIG.blockExplorerUrl,
    },
  },
  contracts: {
    multicall3: {
      address: ROBINHOOD_CHAIN_CONFIG.multicall3,
    },
  },
});
export function robinhoodExplorerAddressUrl(address: string): string {
  return `${ROBINHOOD_CHAIN_CONFIG.blockExplorerUrl}/address/${address}`;
}
export function robinhoodExplorerTxUrl(txHash: string): string {
  return `${ROBINHOOD_CHAIN_CONFIG.blockExplorerUrl}/tx/${txHash}`;
}
