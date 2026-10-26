import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { isValidSolanaPublicKey } from "@/lib/custodial-wallet/validate";
import type { FairscaleAssessmentStatus, FairscaleWalletSource } from "@/lib/fairscale/types";
export type FairscaleAgentWalletInput = {
  id: number;
  chainId: number;
  listingRegistrySource: string;
  owner: string;
  evmWalletAddress?: string | null;
  tokenAddress?: string | null;
  metaplexAgentTokenMint?: string | null;
  sapOwnerWallet?: string | null;
  verifiedWallet?: string | null;
  verifiedWalletChainId?: number | null;
  agentWalletPublicKey?: string | null;
  metadata?: Array<{ key: string; value: string }> | null;
};
export type FairscaleWalletResolution = {
  status: FairscaleAssessmentStatus;
  walletAddress: string | null;
  walletSource: FairscaleWalletSource | null;
};
const REJECTED_METADATA_KEYS = new Set([
  "tokenAddress",
  "tokenMint",
  "mint",
  "liquidityPool",
  "poolAddress",
]);
function metadataAgentWallet(
  metadata?: Array<{ key: string; value: string }> | null,
): string | null {
  if (!metadata?.length) return null;
  const row = metadata.find((m) => m.key === "agentWallet");
  const value = row?.value?.trim();
  if (!value || !isValidSolanaPublicKey(value)) return null;
  return value;
}
function isRejectedAddress(value: string | null | undefined, agent: FairscaleAgentWalletInput): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return true;
  if (!isValidSolanaPublicKey(trimmed)) return true;
  const rejects = [
    agent.tokenAddress,
    agent.metaplexAgentTokenMint,
  ]
    .map((v) => v?.trim())
    .filter(Boolean);
  return rejects.includes(trimmed);
}
function pickWallet(
  address: string | null | undefined,
  source: FairscaleWalletSource,
  agent: FairscaleAgentWalletInput,
): FairscaleWalletResolution | null {
  const trimmed = address?.trim();
  if (!trimmed || isRejectedAddress(trimmed, agent)) return null;
  return {
    status: "pending",
    walletAddress: trimmed,
    walletSource: source,
  };
}
/** Returns eligibility without calling FairScale. Never substitutes mints, PDAs, or creator wallets. */
export function resolveFairscaleAgentWallet(
  agent: FairscaleAgentWalletInput,
  options?: { clusterSiblingWallet?: string | null },
): FairscaleWalletResolution {
  const custodial = pickWallet(agent.agentWalletPublicKey, "custodial", agent);
  if (custodial) return custodial;
  const metadataWallet = pickWallet(metadataAgentWallet(agent.metadata), "metadata", agent);
  if (metadataWallet) return metadataWallet;
  if (agent.listingRegistrySource === "sap") {
    const sap = pickWallet(agent.sapOwnerWallet, "sap_owner", agent);
    if (sap) return sap;
  }
  const sibling = pickWallet(options?.clusterSiblingWallet, "cluster_sibling", agent);
  if (sibling) return sibling;
  const evmOnly =
    agent.chainId !== SOLANA_CHAIN_ID &&
    (Boolean(agent.evmWalletAddress?.trim()) ||
      Boolean(agent.owner?.trim().startsWith("0x")));
  if (evmOnly) {
    return {
      status: "unsupported_network",
      walletAddress: null,
      walletSource: null,
    };
  }
  return {
    status: "missing_wallet",
    walletAddress: null,
    walletSource: null,
  };
}
export function isFairscaleBlockedMetadataKey(key: string): boolean {
  return REJECTED_METADATA_KEYS.has(key);
}
