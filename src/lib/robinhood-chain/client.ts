import { createPublicClient, http } from "viem";
import { ROBINHOOD_CHAIN_CONFIG, robinhoodChain } from "@/lib/robinhood-chain/config";
const ROBINHOOD_RPC_TIMEOUT_MS = 12_000;
export function createRobinhoodPublicClient() {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(ROBINHOOD_CHAIN_CONFIG.rpcUrl, {
      timeout: ROBINHOOD_RPC_TIMEOUT_MS,
      retryCount: 1,
    }),
  });
}
