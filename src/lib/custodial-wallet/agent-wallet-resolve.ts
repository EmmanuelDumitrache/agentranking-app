import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import { loadAgentCustodialWalletPublicKey } from "@/lib/custodial-wallet/read";
import {
  isValidSolanaPublicKey,
  resolveDisplaySolanaPublicKey,
} from "@/lib/custodial-wallet/validate";
export type ResolvedAgentWallet = {
  publicKey: string;
  /** Server holds encrypted key material for this agent wallet. */
  isCustodial: boolean;
  source: "custodial" | "metadata" | "owner";
};
type AgentWalletResolveInput = {
  owner: string;
  listingRegistrySource: string;
  chainId: number;
  metadataWallet?: string | null;
};
export async function resolveAgentWallet(
  agentDbId: number,
  agent: AgentWalletResolveInput,
): Promise<ResolvedAgentWallet | null> {
  const custodialPublicKey = await loadAgentCustodialWalletPublicKey(agentDbId);
  const metadataWallet = agent.metadataWallet?.trim() || null;
  const ownerWallet = isValidSolanaPublicKey(agent.owner) ? agent.owner.trim() : null;
  const publicKey = resolveDisplaySolanaPublicKey(
    custodialPublicKey,
    metadataWallet,
    ownerWallet,
  );
  if (!publicKey) return null;
  const isNative = isAgentRankingNativeAgent(agent);
  let source: ResolvedAgentWallet["source"] = "custodial";
  if (!custodialPublicKey) {
    source = metadataWallet === publicKey ? "metadata" : "owner";
  }
  // Native agents are always created with a server-held custodial wallet.
  const isCustodial = Boolean(custodialPublicKey) || isNative;
  return { publicKey, isCustodial, source };
}
