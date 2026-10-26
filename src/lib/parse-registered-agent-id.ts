import { decodeEventLog, type Log } from "viem";
import { identityRegistryAbi } from "@/lib/identity-registry-abi";
import { getIdentityRegistryAddress } from "@/lib/identity-registry";
export type ParsedRegisteredAgent = {
  agentId: number;
  owner: string;
  agentURI: string;
};
/**
 * Parse agentId (and owner) from IdentityRegistry `Registered` logs.
 * Filters by registry contract address so unrelated logs are ignored.
 */
export function parseRegisteredAgentFromLogs(
  logs: readonly Log[],
  chainId: number,
): ParsedRegisteredAgent | null {
  const registry = getIdentityRegistryAddress(chainId).toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry) continue;
    try {
      const decoded = decodeEventLog({
        abi: identityRegistryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "Registered" || !decoded.args) continue;
      const args = decoded.args as { agentId?: bigint; owner?: string; agentURI?: string };
      if (args.agentId === undefined) continue;
      return {
        agentId: Number(args.agentId),
        owner: typeof args.owner === "string" ? args.owner : "",
        agentURI: typeof args.agentURI === "string" ? args.agentURI : "",
      };
    } catch {
      // Not a Registered event from this registry
    }
  }
  // Mint path: ERC-721 Transfer(from=0x0, tokenId) on the identity registry.
  const transferTopic =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry) continue;
    if (log.topics[0]?.toLowerCase() !== transferTopic) continue;
    const from = log.topics[1];
    if (!from || from.toLowerCase() !== `${zeroAddress.slice(0, 2)}${zeroAddress.slice(2).padStart(64, "0")}`) {
      continue;
    }
    const tokenId = log.topics[3];
    if (!tokenId) continue;
    return {
      agentId: Number(BigInt(tokenId)),
      owner: "",
      agentURI: "",
    };
  }
  return null;
}