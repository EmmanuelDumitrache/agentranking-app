import "server-only";
import type { Session } from "next-auth";
import { PublicKey } from "@solana/web3.js";
import type { AppAccountSummary } from "@/lib/app-account-summary";
import { prisma } from "@/lib/db";
import { getRecentTransfers, type TransferEntry } from "@/lib/agent-transfers";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { isAccountVerifiedStatus } from "@/lib/verification/account-verification-types";
import { loadLatestAgentLaunchForAgent } from "@/lib/agent-launch/agent-launch-for-agent";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import type { AgentLaunchClaimableFeesDto } from "@/lib/agent-launch/claimable-fees";
import { readAgentLaunchClaimableFeesForLaunch } from "@/lib/agent-launch/claimable-fees.server";
import { getAgentLaunchSolBalanceLamports } from "@/lib/agent-launch/solana";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import {
  describeCustodialProvisionError,
  getCustodialProvisionBlocker,
} from "@/lib/custodial-wallet/bootstrap";
import { readMaxAgentsForAccount } from "@/lib/custodial-wallet/config";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
import { isValidSolanaPublicKey } from "@/lib/custodial-wallet/validate";
import { loadAgentWalletSummary } from "@/lib/agent-wallet-summary.server";
import { serializeRobinhoodLaunch } from "@/lib/robinhood-chain/serialize";
import type { RobinhoodLaunchRecord } from "@/lib/robinhood-chain/types";
import type { DashboardRobinhoodClaimableFeesDto } from "@/lib/robinhood-chain/dashboard-claimable-fees";
import { readDashboardRobinhoodClaimableFees } from "@/lib/robinhood-chain/dashboard-claimable-fees.server";
export type AgentWalletTransfer = TransferEntry;
export type AgentEvmActivityRow = {
  id: string;
  type: "launch";
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenAddress: string;
  txHash: string;
  sourceVerified: boolean;
  blockTimestamp: string;
};
export async function loadAgentWalletTransfers(
  agentDbId: number,
  limit = 10,
): Promise<AgentWalletTransfer[]> {
  return getRecentTransfers(agentDbId, Math.min(Math.max(limit, 1), 100));
}
export async function loadAgentEvmActivity(
  agentDbId: number,
  limit = 10,
): Promise<AgentEvmActivityRow[]> {
  const launches = await prisma.robinhoodChainLaunch.findMany({
    where: { agentDbId },
    orderBy: { blockTimestamp: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      tokenName: true,
      tokenSymbol: true,
      tokenAddress: true,
      txHash: true,
      sourceVerified: true,
      blockTimestamp: true,
    },
  });
  return launches.map((launch) => ({
    id: launch.id,
    type: "launch" as const,
    tokenName: launch.tokenName,
    tokenSymbol: launch.tokenSymbol,
    tokenAddress: launch.tokenAddress,
    txHash: launch.txHash,
    sourceVerified: launch.sourceVerified,
    blockTimestamp: launch.blockTimestamp.toISOString(),
  }));
}
export type DashboardWalletPageData = {
  account: AppAccountSummary;
  agent: {
    id: number;
    name: string;
    image: string;
    agentWalletPublicKey: string | null;
    agentWalletSolscanUrl: string | null;
    agentWalletIsCustodial: boolean;
    solBalanceLamports: number | null;
    canProvisionSolanaWallet: boolean;
    solanaWalletProvisionError: string | null;
  } | null;
  solanaNetwork: string;
  solPrice: number | null;
  ethPrice: number | null;
  evmWallet: {
    configured: boolean;
    address: string | null;
    status: string;
    provider: string | null;
    isCustodial: boolean;
    ethBalance: string | null;
    robinhoodEthBalance: string | null;
    ethPrice: number | null;
  } | null;
  transfers: AgentWalletTransfer[];
  evmActivity: AgentEvmActivityRow[];
  /** Most recent Robinhood Chain launch for this agent (fee claim UI). */
  solanaLaunchId: string | null;
  solanaClaimableFees: AgentLaunchClaimableFeesDto | null;
  robinhoodLaunch: RobinhoodLaunchRecord | null;
  robinhoodClaimableFees: DashboardRobinhoodClaimableFeesDto | null;
};
export type LoadDashboardWalletPageOptions = {
  nativeAgentCount?: number;
};
async function loadSolanaBalance(publicKey: string | null): Promise<number | null> {
  if (!publicKey || !isValidSolanaPublicKey(publicKey)) return null;
  try {
    return await getAgentLaunchSolBalanceLamports(new PublicKey(publicKey));
  } catch {
    return null;
  }
}
function parseSafeLamports(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
export type LoadDashboardAccountWalletSummaryOptions = {
  nativeAgentCount?: number;
  skipLiveBalance?: boolean;
};
export async function loadDashboardAccountWalletSummary(
  session: Session | null,
  options: LoadDashboardAccountWalletSummaryOptions = {},
): Promise<AppAccountSummary | null> {
  const nativeAgentCount = options.nativeAgentCount ?? 0;
  const profile = await getDashboardUserProfile(session);
  if (!profile) return null;
  const account = await prisma.appAccount.findUnique({
    where: { userProfileId: profile.id },
    select: {
      id: true,
      displayName: true,
      email: true,
      platformCredits: true,
      llmBalanceCents: true,
      maxAgents: true,
      verificationStatus: true,
      verificationExpiresAt: true,
      publicId: true,
      cachedSolBalanceLamports: true,
      accountWallet: { select: { publicKey: true } },
    },
  });
  const launchConfig = getAgentLaunchConfig();
  const custodialPublicKey = account?.accountWallet?.publicKey?.trim() || null;
  const linkedSolana = profile.solanaWallet?.trim() || null;
  const linkedEvm = profile.walletAddress?.trim() || null;
  const accountWalletPublicKey =
    custodialPublicKey ??
    (linkedSolana && isValidSolanaPublicKey(linkedSolana) ? linkedSolana : null) ??
    linkedEvm;
  const accountWalletSource: AppAccountSummary["accountWalletSource"] =
    custodialPublicKey
      ? "custodial"
      : linkedSolana && isValidSolanaPublicKey(linkedSolana)
        ? "linked_solana"
        : linkedEvm
          ? "linked_evm"
          : "pending_custodial";
  const cachedLamports = account?.cachedSolBalanceLamports;
  const cachedBalance =
    cachedLamports != null && cachedLamports <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(cachedLamports)
      : null;
  const liveBalance =
    !options.skipLiveBalance &&
    (accountWalletSource === "custodial" || accountWalletSource === "linked_solana")
      ? await loadSolanaBalance(accountWalletPublicKey)
      : null;
  const blocker = getCustodialProvisionBlocker();
  const walletProvisionError = accountWalletPublicKey
    ? null
    : !account
      ? "Account setup is incomplete. Create the account before provisioning a wallet."
      : blocker.ok
        ? "Account wallet is not provisioned yet."
        : describeCustodialProvisionError(blocker.code);
  const platformCredits = account?.platformCredits ?? 0;
  const llmBalanceCents = account?.llmBalanceCents ?? 0;
  const accountIsVerified = account
    ? isAccountVerifiedStatus(account.verificationStatus, account.verificationExpiresAt)
    : false;
  const credentialPublicId =
    accountIsVerified && account?.publicId?.trim() ? account.publicId.trim() : null;
  return {
    accountId: account?.id ?? null,
    profileId: profile.id,
    displayName:
      account?.displayName?.trim() ||
      profile.displayName?.trim() ||
      session?.user?.name?.trim() ||
      "Account",
    avatarUrl: profile.avatarUrl?.trim() || session?.user?.image?.trim() || null,
    email: account?.email ?? profile.email ?? session?.user?.email ?? null,
    accountWalletPublicKey,
    accountWalletSource,
    accountWalletSolscanUrl:
      accountWalletPublicKey &&
      (accountWalletSource === "custodial" || accountWalletSource === "linked_solana")
        ? solscanAccountUrlForNetwork(accountWalletPublicKey, launchConfig.network)
        : null,
    solanaNetwork: launchConfig.network,
    platformCredits,
    llmBalanceCents,
    totalBalance: platformCredits + llmBalanceCents,
    agentCount: nativeAgentCount,
    maxAgents: account?.maxAgents ?? readMaxAgentsForAccount(),
    accountIsVerified,
    credentialPublicId,
    solBalanceLamports: liveBalance ?? cachedBalance,
    walletProvisionError,
  };
}
export async function loadDashboardWalletPageData(
  session: Session | null,
  agentDbId?: number | null,
  options: LoadDashboardWalletPageOptions = {},
): Promise<DashboardWalletPageData | null> {
  if (!hasDashboardSessionIdentity(session) || !session) return null;
  const nativeAgentCount = options.nativeAgentCount ?? 0;
  const accountPromise = loadDashboardAccountWalletSummary(session, {
    nativeAgentCount,
  });
  const launchConfig = getAgentLaunchConfig();
  if (agentDbId == null) {
    const account = await accountPromise;
    if (!account) return null;
    return {
      account,
      agent: null,
      solanaNetwork: launchConfig.network,
      solPrice: null,
      ethPrice: null,
      evmWallet: null,
      transfers: [],
      evmActivity: [],
      solanaLaunchId: null,
      solanaClaimableFees: null,
      robinhoodLaunch: null,
      robinhoodClaimableFees: null,
    };
  }
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return null;
  const [
    account,
    summary,
    transfers,
    evmActivity,
    solanaLaunchRow,
    robinhoodLaunchRow,
  ] = await Promise.all([
      accountPromise,
      loadAgentWalletSummary(agentDbId),
      loadAgentWalletTransfers(agentDbId, 10),
      loadAgentEvmActivity(agentDbId, 10),
      loadLatestAgentLaunchForAgent(agentDbId),
      prisma.robinhoodChainLaunch.findFirst({
        where: { agentDbId },
        orderBy: { blockTimestamp: "desc" },
      }),
    ]);
  if (!account) return null;
  const walletBlocker = getCustodialProvisionBlocker();
  const isNative = isAgentRankingNativeAgent(access.agent);
  const canProvisionSolanaWallet =
    !summary.solana.address && isNative && walletBlocker.ok;
  const solanaWalletProvisionError = summary.solana.address
    ? null
    : !isNative
      ? "Only AgentRanking native agents can provision a custodial Solana wallet."
      : walletBlocker.ok
        ? null
        : describeCustodialProvisionError(walletBlocker.code);
  const indexedSolanaLaunch =
    solanaLaunchRow?.launchStatus === "indexed" ? solanaLaunchRow : null;
  const robinhoodLaunch = robinhoodLaunchRow
    ? serializeRobinhoodLaunch(robinhoodLaunchRow)
    : null;
  const [solanaClaimableFees, robinhoodClaimableFees] = await Promise.all([
    indexedSolanaLaunch
      ? readAgentLaunchClaimableFeesForLaunch(indexedSolanaLaunch).catch(
          () => null,
        )
      : Promise.resolve(null),
    robinhoodLaunch
      ? readDashboardRobinhoodClaimableFees({
          launch: robinhoodLaunch,
          agentEvmAddress: summary.evm.address,
          agentEvmStatus: summary.evm.status,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    account,
    agent: {
      id: access.agent.id,
      name: access.agent.name,
      image: access.agent.image,
      agentWalletPublicKey: summary.solana.address,
      agentWalletSolscanUrl: summary.solana.explorerUrl,
      agentWalletIsCustodial: summary.solana.isCustodial,
      solBalanceLamports: parseSafeLamports(
        summary.solana.balances.nativeRaw,
      ),
      canProvisionSolanaWallet,
      solanaWalletProvisionError,
    },
    solanaNetwork: launchConfig.network,
    solPrice: summary.solPrice,
    ethPrice: summary.ethPrice,
    evmWallet: {
      configured: summary.evm.configured,
      address: summary.evm.address,
      status: summary.evm.status,
      provider: summary.evm.provider,
      isCustodial: summary.evm.isCustodial,
      ethBalance: summary.evm.mainnet.balances.nativeRaw == null
        ? null
        : summary.evm.mainnet.balances.nativeDisplay,
      robinhoodEthBalance: summary.evm.robinhood.balances.nativeRaw == null
        ? null
        : summary.evm.robinhood.balances.nativeDisplay,
      ethPrice: summary.ethPrice,
    },
    transfers,
    evmActivity,
    solanaLaunchId: indexedSolanaLaunch?.id ?? null,
    solanaClaimableFees,
    robinhoodLaunch,
    robinhoodClaimableFees,
  };
}
