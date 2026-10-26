import { createPublicClient, defineChain, http, type Hash, type TransactionReceipt } from "viem";
import { getEvmRpcUrls } from "@/lib/evm-rpc-url";
const RECEIPT_TIMEOUT_MS = 12_000;
export async function fetchEvmTransactionReceipt(
  chainId: number,
  txHash: Hash,
): Promise<TransactionReceipt | null> {
  const rpcUrls = getEvmRpcUrls(chainId);
  if (rpcUrls.length === 0) return null;
  const chain = defineChain({
    id: chainId,
    name: String(chainId),
    nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" },
    rpcUrls: { default: { http: rpcUrls } },
  });
  for (const url of rpcUrls) {
    try {
      const client = createPublicClient({
        chain,
        transport: http(url, { timeout: RECEIPT_TIMEOUT_MS }),
      });
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      if (receipt) return receipt;
    } catch {
      // Try next RPC (Infura 402, dead endpoints, etc.)
    }
  }
  return null;
}