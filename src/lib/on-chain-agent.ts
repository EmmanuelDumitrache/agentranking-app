import { createPublicClient, defineChain, http } from "viem";
import { getChainByChainId } from "@/lib/chains";
import { RPC_URLS } from "@/lib/erc8004-sync";
const OWNER_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "getAgentWallet",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;
/**
 * Fetch on-chain owner and agentWallet for an agent.
 * Returns null if RPC/config unavailable or call fails.
 */
export async function fetchOnChainOwnerAndWallet(
  chainId: number,
  agentId: number
): Promise<{ owner: string; agentWallet: string | null } | null> {
  const chainConfig = getChainByChainId(chainId);
  const rpcUrl = RPC_URLS[chainId];
  if (!chainConfig?.identityRegistry || !rpcUrl?.trim()) return null;
  try {
    const chain = defineChain({ id: chainId, name: String(chainId), nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [rpcUrl] } } });
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    const identityRegistry = chainConfig.identityRegistry as `0x${string}`;
    const [owner, agentWallet] = await Promise.all([
      client.readContract({ address: identityRegistry, abi: OWNER_ABI, functionName: "ownerOf", args: [BigInt(agentId)] }),
      client.readContract({ address: identityRegistry, abi: OWNER_ABI, functionName: "getAgentWallet", args: [BigInt(agentId)] }).catch(() => null as string | null),
    ]);
    const zero = "0x0000000000000000000000000000000000000000";
    return {
      owner: String(owner ?? ""),
      agentWallet: agentWallet && agentWallet !== zero ? String(agentWallet) : null,
    };
  } catch {
    return null;
  }
}