/**
 * Server-side EVM wallet setup for agents.
 * Prefer custodial (server-held) keys for one-click Robinhood launch/claim.
 * Privy embedded wallets remain supported for Privy-linked agents.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { ROBINHOOD_CHAIN_ID } from "@/lib/robinhood-chain/config";
import {
  fetchEthereumMainnetEthBalance,
  fetchRobinhoodChainEthBalance,
} from "@/lib/evm-wallet-utils";
import { buildOwnedAgentsWhere, type DashboardProfileWallets } from "@/lib/dashboard/agent-ownership";
import {
  getCustodialProvisionBlocker,
  describeCustodialProvisionError,
} from "@/lib/custodial-wallet/bootstrap";
import { provisionCustodialEvmWallet } from "@/lib/custodial-wallet/provision";
import {
  attachAgentEvmWalletInTx,
  loadAgentCustodialEvmAddress,
  loadAgentEvmWalletIdInTx,
  loadCustodialPublicKeyByWalletId,
} from "@/lib/custodial-wallet/read";
export type AgentEvmWalletInfo = {
  configured: boolean;
  address: string | null;
  privyWalletId: string | null;
  provider: string;
  status: string;
  chainId: number;
  createdAt: Date | null;
  isCustodial: boolean;
};
export type AgentEvmWalletSnapshot = {
  configured: boolean;
  address: string | null;
  privyWalletId: string | null;
  provider: string;
  status: string;
  chainId: number;
  createdAt: string | null;
  isCustodial: boolean;
  balances: {
    mainnet: { wei: string; ether: string } | null;
    robinhood: { wei: string; ether: string } | null;
  };
};
/**
 * Read the current EVM wallet association for an agent.
 * Returns not_configured state when no wallet exists.
 */
export async function getAgentEvmWallet(agentDbId: number): Promise<AgentEvmWalletInfo> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      evmWalletAddress: true,
      evmPrivyWalletId: true,
      evmWalletProvider: true,
      evmWalletStatus: true,
      evmWalletCreatedAt: true,
      agentEvmWalletId: true,
    },
  });
  if (!agent) {
    return {
      configured: false,
      address: null,
      privyWalletId: null,
      provider: "custodial",
      status: "not_configured",
      chainId: ROBINHOOD_CHAIN_ID,
      createdAt: null,
      isCustodial: false,
    };
  }
  const isCustodial = agent.evmWalletProvider === "custodial" && Boolean(agent.agentEvmWalletId);
  const configured =
    agent.evmWalletStatus === "active" &&
    Boolean(agent.evmWalletAddress) &&
    (isCustodial || Boolean(agent.evmPrivyWalletId));
  return {
    configured,
    address: agent.evmWalletAddress,
    privyWalletId: agent.evmPrivyWalletId,
    provider: agent.evmWalletProvider,
    status: agent.evmWalletStatus,
    chainId: ROBINHOOD_CHAIN_ID,
    createdAt: agent.evmWalletCreatedAt,
    isCustodial,
  };
}

/**
 * Load a serialisable public EVM wallet snapshot. Private key material and
 * provider objects never leave the server.
 */
export async function loadAgentEvmWalletSnapshot(
  agentDbId: number,
): Promise<AgentEvmWalletSnapshot> {
  const wallet = await getAgentEvmWallet(agentDbId);
  let mainnet: { wei: string; ether: string } | null = null;
  let robinhood: { wei: string; ether: string } | null = null;

  if (wallet.configured && wallet.address) {
    const [mainnetBalance, robinhoodBalance] = await Promise.all([
      fetchEthereumMainnetEthBalance(wallet.address),
      fetchRobinhoodChainEthBalance(wallet.address),
    ]);
    mainnet = mainnetBalance;
    robinhood = robinhoodBalance;
  }

  return {
    configured: wallet.configured,
    address: wallet.address,
    privyWalletId: wallet.privyWalletId,
    provider: wallet.provider,
    status: wallet.status,
    chainId: wallet.chainId,
    createdAt: wallet.createdAt?.toISOString() ?? null,
    isCustodial: wallet.isCustodial,
    balances: { mainnet, robinhood },
  };
}

/**
 * Provision a custodial EVM wallet for an agent (server-signed launches/claims).
 */
export async function provisionAgentCustodialEvmWallet(
  agentDbId: number,
  actorProfileId: number,
): Promise<AgentEvmWalletInfo> {
  const blocker = getCustodialProvisionBlocker();
  if (!blocker.ok) {
    throw new Error(describeCustodialProvisionError(blocker.code));
  }
  const existing = await getAgentEvmWallet(agentDbId);
  if (existing.configured && existing.address) {
    return existing;
  }
  const custodialAddress = await loadAgentCustodialEvmAddress(agentDbId);
  if (custodialAddress) {
    return getAgentEvmWallet(agentDbId);
  }
  await prisma.$transaction(async (tx) => {
    const lockedWalletId = await loadAgentEvmWalletIdInTx(tx, agentDbId);
    if (lockedWalletId) {
      const publicKey = await loadCustodialPublicKeyByWalletId(lockedWalletId);
      if (publicKey) return;
    }
    const created = await provisionCustodialEvmWallet(tx, {
      scope: "AGENT",
      actorProfileId,
    });
    await attachAgentEvmWalletInTx(tx, agentDbId, created.id, created.publicKey);
  });
  return getAgentEvmWallet(agentDbId);
}
/**
 * Persist a newly created Privy EVM wallet association for a Privy-linked agent.
 */
export async function associateAgentEvmWallet(
  agentDbId: number,
  evmAddress: string,
  privyWalletId: string,
): Promise<AgentEvmWalletInfo> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { id: true, evmWalletAddress: true, evmWalletStatus: true },
  });
  if (!agent) throw new Error("Agent not found");
  if (
    agent.evmWalletAddress &&
    agent.evmWalletAddress.toLowerCase() === evmAddress.toLowerCase() &&
    agent.evmWalletStatus === "active"
  ) {
    return getAgentEvmWallet(agentDbId);
  }
  const normalizedAddress = evmAddress.toLowerCase();
  const existing = await prisma.agent.findFirst({
    where: {
      id: { not: agentDbId },
      OR: [
        { evmWalletAddress: normalizedAddress },
        { evmPrivyWalletId: privyWalletId },
      ],
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error("This EVM wallet is already assigned to another agent.");
  }
  const now = new Date();
  await prisma.agent.update({
    where: { id: agentDbId },
    data: {
      evmWalletAddress: normalizedAddress,
      evmPrivyWalletId: privyWalletId,
      evmWalletProvider: "privy_embedded",
      evmWalletStatus: "active",
      evmWalletCreatedAt: now,
    },
  });
  return getAgentEvmWallet(agentDbId);
}
/**
 * Mark an agent's EVM wallet as 'creating' to prevent double-creation during setup.
 */
export async function markEvmWalletCreating(agentDbId: number): Promise<void> {
  await prisma.agent.updateMany({
    where: {
      id: agentDbId,
      evmWalletStatus: { in: ["not_configured", "failed"] },
    },
    data: { evmWalletStatus: "creating" },
  });
}
/**
 * Clean up a failed creation attempt (reset to not_configured).
 */
export async function markEvmWalletFailed(agentDbId: number): Promise<void> {
  await prisma.agent.updateMany({
    where: { id: agentDbId, evmWalletStatus: "creating" },
    data: { evmWalletStatus: "failed" },
  });
}
export type AssignedEvmWalletRow = {
  agentDbId: number;
  address: string;
  privyWalletId: string;
};
/**
 * List Privy EVM wallets already assigned to agents owned by this user.
 * Used when linking Privy wallets.
 */
export async function listAssignedEvmWalletsForProfile(
  profile: DashboardProfileWallets,
): Promise<AssignedEvmWalletRow[]> {
  const agents = await prisma.agent.findMany({
    where: {
      AND: [
        buildOwnedAgentsWhere(profile),
        { evmWalletStatus: "active" },
        { evmWalletAddress: { not: null } },
        { evmPrivyWalletId: { not: null } },
      ],
    },
    select: {
      id: true,
      evmWalletAddress: true,
      evmPrivyWalletId: true,
    },
  });
  return agents
    .filter(
      (a): a is typeof a & { evmWalletAddress: string; evmPrivyWalletId: string } =>
        Boolean(a.evmWalletAddress && a.evmPrivyWalletId),
    )
    .map((a) => ({
      agentDbId: a.id,
      address: a.evmWalletAddress.toLowerCase(),
      privyWalletId: a.evmPrivyWalletId,
    }));
}
