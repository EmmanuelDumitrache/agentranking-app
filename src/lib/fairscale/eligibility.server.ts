import { prisma } from "@/lib/db";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { loadAgentCustodialWalletPublicKey } from "@/lib/custodial-wallet/read";
import {
  resolveFairscaleAgentWallet,
  type FairscaleAgentWalletInput,
} from "@/lib/fairscale/wallet-resolve";
const AGENT_FAIRSCALE_SELECT = {
  id: true,
  chainId: true,
  listingRegistrySource: true,
  owner: true,
  tokenAddress: true,
  metaplexAgentTokenMint: true,
  sapOwnerWallet: true,
  verifiedWallet: true,
  verifiedWalletChainId: true,
  clusterKey: true,
  evmWalletAddress: true,
  metadata: { select: { key: true, value: true } },
} as const;
export async function loadFairscaleAgentWalletInput(
  agentDbId: number,
): Promise<{ input: FairscaleAgentWalletInput; clusterSiblingWallet: string | null } | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: AGENT_FAIRSCALE_SELECT,
  });
  if (!agent) return null;
  const custodial = await loadAgentCustodialWalletPublicKey(agentDbId);
  let clusterSiblingWallet: string | null = null;
  const clusterKey = agent.clusterKey?.trim();
  if (clusterKey && agent.chainId !== SOLANA_CHAIN_ID) {
    const sibling = await prisma.agent.findFirst({
      where: {
        clusterKey,
        chainId: SOLANA_CHAIN_ID,
        id: { not: agentDbId },
      },
      select: {
        id: true,
        sapOwnerWallet: true,
        metadata: { where: { key: "agentWallet" }, select: { value: true } },
      },
    });
    if (sibling) {
      const siblingCustodial = await loadAgentCustodialWalletPublicKey(sibling.id);
      const metaWallet = sibling.metadata[0]?.value?.trim() || null;
      clusterSiblingWallet = siblingCustodial || metaWallet || sibling.sapOwnerWallet;
    }
  }
  return {
    input: {
      id: agent.id,
      chainId: agent.chainId,
      listingRegistrySource: agent.listingRegistrySource,
      owner: agent.owner,
      tokenAddress: agent.tokenAddress,
      metaplexAgentTokenMint: agent.metaplexAgentTokenMint,
      sapOwnerWallet: agent.sapOwnerWallet,
      verifiedWallet: agent.verifiedWallet,
      verifiedWalletChainId: agent.verifiedWalletChainId,
      evmWalletAddress: agent.evmWalletAddress,
      agentWalletPublicKey: custodial,
      metadata: agent.metadata,
    },
    clusterSiblingWallet,
  };
}
export async function resolveFairscaleWalletForAgent(agentDbId: number) {
  const loaded = await loadFairscaleAgentWalletInput(agentDbId);
  if (!loaded) {
    return {
      status: "missing_wallet" as const,
      walletAddress: null,
      walletSource: null,
    };
  }
  return resolveFairscaleAgentWallet(loaded.input, {
    clusterSiblingWallet: loaded.clusterSiblingWallet,
  });
}
